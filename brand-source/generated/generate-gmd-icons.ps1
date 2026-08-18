[CmdletBinding()]
param(
    [string]$SourcePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'gmd-logo-source.jpg'),
    [string]$OutputDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 64, 128, 256, 512)
$icoSizes = @(16, 32, 48, 64, 128, 256)

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw "Logo source not found: $SourcePath"
}

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path

function Save-ResizedPng {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.Image]$Source,

        [Parameter(Mandatory)]
        [int]$Size,

        [Parameter(Mandatory)]
        [string]$Destination
    )

    # A small, symmetric crop makes the subject read more clearly at tray-icon sizes.
    $cropRatio = 0.96
    $cropWidth = [int][Math]::Round($Source.Width * $cropRatio)
    $cropHeight = [int][Math]::Round($Source.Height * $cropRatio)
    $cropX = [int][Math]::Floor(($Source.Width - $cropWidth) / 2)
    $cropY = [int][Math]::Floor(($Source.Height - $cropHeight) / 2)

    $bitmap = [System.Drawing.Bitmap]::new(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )

    try {
        $bitmap.SetResolution(96, 96)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

            $destinationRectangle = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
            $graphics.DrawImage(
                $Source,
                $destinationRectangle,
                $cropX,
                $cropY,
                $cropWidth,
                $cropHeight,
                [System.Drawing.GraphicsUnit]::Pixel
            )
        }
        finally {
            $graphics.Dispose()
        }

        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }
}

function Write-MultiResolutionIco {
    param(
        [Parameter(Mandatory)]
        [int[]]$Sizes,

        [Parameter(Mandatory)]
        [string]$PngDirectory,

        [Parameter(Mandatory)]
        [string]$Destination
    )

    $entries = foreach ($size in $Sizes) {
        $pngPath = Join-Path $PngDirectory ("gmd-icon-{0}.png" -f $size)
        [pscustomobject]@{
            Size = $size
            Data = [System.IO.File]::ReadAllBytes($pngPath)
        }
    }

    $stream = [System.IO.File]::Open(
        $Destination,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $writer = [System.IO.BinaryWriter]::new($stream)

    try {
        $writer.Write([uint16]0) # Reserved
        $writer.Write([uint16]1) # ICO image
        $writer.Write([uint16]$entries.Count)

        $dataOffset = 6 + (16 * $entries.Count)
        foreach ($entry in $entries) {
            $encodedSize = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
            $writer.Write([byte]$encodedSize)
            $writer.Write([byte]$encodedSize)
            $writer.Write([byte]0) # Palette colors
            $writer.Write([byte]0) # Reserved
            $writer.Write([uint16]1) # Color planes
            $writer.Write([uint16]32) # Bits per pixel
            $writer.Write([uint32]$entry.Data.Length)
            $writer.Write([uint32]$dataOffset)
            $dataOffset += $entry.Data.Length
        }

        foreach ($entry in $entries) {
            $writer.Write([byte[]]$entry.Data)
        }
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

$sourceImage = [System.Drawing.Image]::FromFile($resolvedSource)
try {
    if ($sourceImage.Width -ne $sourceImage.Height) {
        throw "Logo source must be square. Actual size: $($sourceImage.Width)x$($sourceImage.Height)"
    }

    foreach ($size in $sizes) {
        $destination = Join-Path $resolvedOutput ("gmd-icon-{0}.png" -f $size)
        Save-ResizedPng -Source $sourceImage -Size $size -Destination $destination
    }
}
finally {
    $sourceImage.Dispose()
}

$icoPath = Join-Path $resolvedOutput 'gmd-icon.ico'
Write-MultiResolutionIco -Sizes $icoSizes -PngDirectory $resolvedOutput -Destination $icoPath

$assetFiles = @(
    foreach ($size in $sizes) {
        Get-Item -LiteralPath (Join-Path $resolvedOutput ("gmd-icon-{0}.png" -f $size))
    }
    Get-Item -LiteralPath $icoPath
)

$manifest = [ordered]@{
    source = [ordered]@{
        file = $resolvedSource
        sha256 = (Get-FileHash -LiteralPath $resolvedSource -Algorithm SHA256).Hash.ToLowerInvariant()
        dimensions = '1080x1080'
    }
    processing = [ordered]@{
        crop = 'center 96%'
        interpolation = 'HighQualityBicubic'
        color_adjustments = 'none'
    }
    png_sizes = $sizes
    ico_sizes = $icoSizes
    assets = @(
        foreach ($asset in $assetFiles) {
            [ordered]@{
                file = $asset.Name
                bytes = $asset.Length
                sha256 = (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    )
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
    (Join-Path $resolvedOutput 'manifest.json'),
    $manifestJson + [Environment]::NewLine,
    $utf8WithoutBom
)

Write-Output "Generated GMD icon assets in: $resolvedOutput"
