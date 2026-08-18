use std::fs;
use std::path::Path;

use toml_edit::Document;

const CODEX_FEATURES_KEY: &str = "features";
const CODEX_RESPECT_SYSTEM_PROXY_KEY: &str = "respect_system_proxy";
const CODEX_MODEL_KEY: &str = "model";
const CODEX_MODEL_PROVIDER_KEY: &str = "model_provider";
const CODEX_MODEL_CATALOG_JSON_KEY: &str = "model_catalog_json";
const CODEX_MODEL_PROVIDERS_KEY: &str = "model_providers";
const CODEX_BASE_URL_KEY: &str = "base_url";
const CODEX_SUPPORTS_WEBSOCKETS_KEY: &str = "supports_websockets";
const CODEX_GMD_RELAY_HOSTS: [&str; 2] = ["api.gmd.ink", "subapi.gmd.ink"];
const CODEX_PROJECTS_TABLE_PREFIX: &str = "[projects.";
const UTF8_BOM: char = '\u{feff}';

#[cfg(target_os = "windows")]
fn clear_windows_config_file_attributes(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_READONLY,
        FILE_ATTRIBUTE_SYSTEM, FILE_FLAGS_AND_ATTRIBUTES, INVALID_FILE_ATTRIBUTES,
    };

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let attributes = unsafe { GetFileAttributesW(PCWSTR(wide_path.as_ptr())) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(format!(
            "读取 Codex config.toml 文件属性失败: {}",
            path.display()
        ));
    }

    let protected_attributes =
        FILE_ATTRIBUTE_READONLY.0 | FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0;
    let next_attributes = attributes & !protected_attributes;
    if next_attributes == attributes {
        return Ok(());
    }

    unsafe {
        SetFileAttributesW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(next_attributes),
        )
    }
    .map_err(|error| {
        format!(
            "清理 Codex config.toml 文件属性失败: path={}, error={}",
            path.display(),
            error
        )
    })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn clear_windows_config_file_attributes(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn prepare_codex_config_file_for_write(path: &Path) -> Result<(), String> {
    clear_windows_config_file_attributes(path)
}

pub fn normalize_config_toml_spacing(content: &str) -> String {
    let mut normalized = String::with_capacity(content.len());
    let mut blank_line_count = 0usize;

    for line in content.lines() {
        if line.trim().is_empty() {
            blank_line_count += 1;
            if blank_line_count <= 1 {
                normalized.push('\n');
            }
            continue;
        }

        blank_line_count = 0;
        normalized.push_str(line);
        normalized.push('\n');
    }

    normalized
}

pub fn codex_config_doc_to_string(doc: &mut Document) -> String {
    normalize_config_toml_spacing(&doc.to_string())
}

/// Ensure managed Codex profiles honor the operating system proxy.
///
/// Codex keeps this option under the `[features]` table.  Existing feature
/// entries are deliberately left intact; a legacy scalar `features = true`
/// value is also left untouched because replacing it would change an
/// unrelated user setting and may not be understood by every Codex version.
pub fn ensure_respect_system_proxy_feature(doc: &mut Document) -> bool {
    if doc.get(CODEX_FEATURES_KEY).is_none() {
        doc[CODEX_FEATURES_KEY] = toml_edit::table();
    }

    let Some(features) = doc.get_mut(CODEX_FEATURES_KEY) else {
        return false;
    };

    if let Some(table) = features.as_table_mut() {
        // A value already present in the user's config is an explicit choice.
        // Only provide the managed default when the key is absent.
        if table.contains_key(CODEX_RESPECT_SYSTEM_PROXY_KEY) {
            return false;
        }
        table[CODEX_RESPECT_SYSTEM_PROXY_KEY] = toml_edit::value(true);
        return true;
    }

    if let Some(inline) = features.as_inline_table_mut() {
        if inline.contains_key(CODEX_RESPECT_SYSTEM_PROXY_KEY) {
            return false;
        }
        inline.insert(
            CODEX_RESPECT_SYSTEM_PROXY_KEY,
            toml_edit::Value::from(true),
        );
        return true;
    }

    false
}

fn is_gmd_relay_base_url(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw.trim()) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    CODEX_GMD_RELAY_HOSTS
        .iter()
        .any(|candidate| host.eq_ignore_ascii_case(candidate))
}

/// GMD relay endpoints currently expose the Responses HTTP protocol, not the
/// Codex Responses WebSocket transport.  Older profiles may still use the
/// built-in `OpenAI` provider name and therefore bypass the account writer's
/// capability field.  Normalize only the two GMD hosts so unrelated providers
/// and all user-selected routing fields remain untouched.
fn ensure_gmd_relay_http_only_providers(doc: &mut Document) -> bool {
    let Some(model_providers) = doc
        .get_mut(CODEX_MODEL_PROVIDERS_KEY)
        .and_then(|item| item.as_table_mut())
    else {
        return false;
    };

    let mut changed = false;
    for (provider_id, provider) in model_providers.iter_mut() {
        let Some(provider_table) = provider.as_table_mut() else {
            continue;
        };
        let Some(base_url) = provider_table
            .get(CODEX_BASE_URL_KEY)
            .and_then(|item| item.as_str())
            .map(str::to_owned)
        else {
            continue;
        };
        if !is_gmd_relay_base_url(&base_url) {
            continue;
        }

        let supports_websockets = provider_table
            .get(CODEX_SUPPORTS_WEBSOCKETS_KEY)
            .and_then(|item| item.as_bool());
        if supports_websockets == Some(false) {
            continue;
        }

        provider_table[CODEX_SUPPORTS_WEBSOCKETS_KEY] = toml_edit::value(false);
        changed = true;
        crate::modules::logger::log_info(&format!(
            "[Codex Config] disabled Responses WebSocket for GMD relay provider: {}",
            provider_id
        ));
    }
    changed
}

pub fn write_codex_config_toml_atomic(path: &Path, content: &str) -> Result<(), String> {
    prepare_codex_config_file_for_write(path)?;
    crate::modules::atomic_write::write_string_atomic(path, content)
}

fn strip_utf8_bom(content: &str) -> (&str, bool) {
    match content.strip_prefix(UTF8_BOM) {
        Some(stripped) => (stripped, true),
        None => (content, false),
    }
}

fn contains_toml_unicode_escape(value: &str) -> bool {
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0usize;
    while index + 1 < chars.len() {
        if chars[index] == '\\' && matches!(chars[index + 1], 'u' | 'U') {
            let expected_len = if chars[index + 1] == 'u' { 4 } else { 8 };
            if chars
                .iter()
                .skip(index + 2)
                .take(expected_len)
                .filter(|ch| ch.is_ascii_hexdigit())
                .count()
                == expected_len
            {
                return true;
            }
        }
        index += 1;
    }
    false
}

fn is_table_header_line(trimmed_line: &str) -> bool {
    trimmed_line.starts_with('[')
}

fn is_projects_table_header(trimmed_line: &str) -> bool {
    trimmed_line.starts_with(CODEX_PROJECTS_TABLE_PREFIX)
}

fn header_parses_as_toml_table(trimmed_line: &str) -> bool {
    format!("{}\n__cockpit_probe = true\n", trimmed_line)
        .parse::<Document>()
        .is_ok()
}

fn is_unsafe_projects_header(trimmed_line: &str) -> bool {
    is_projects_table_header(trimmed_line)
        && (!trimmed_line.contains(']')
            || !trimmed_line.is_ascii()
            || contains_toml_unicode_escape(trimmed_line)
            || !header_parses_as_toml_table(trimmed_line))
}

fn remove_project_sections(content: &str, aggressive: bool) -> (String, bool) {
    let mut output = String::with_capacity(content.len());
    let mut skipping_project = false;
    let mut changed = false;

    for line in content.lines() {
        let trimmed = line.trim_start();
        let should_start_skip = if aggressive {
            is_projects_table_header(trimmed)
        } else {
            is_unsafe_projects_header(trimmed)
        };

        if should_start_skip {
            skipping_project = true;
            changed = true;
            continue;
        }

        if skipping_project && is_table_header_line(trimmed) {
            skipping_project = false;
        }

        if !skipping_project {
            output.push_str(line);
            output.push('\n');
        }
    }

    if changed {
        (normalize_config_toml_spacing(&output), true)
    } else {
        (content.to_string(), false)
    }
}

pub fn normalize_codex_config_input(content: &str) -> (String, bool) {
    let (without_bom, removed_bom) = strip_utf8_bom(content);
    let (without_unsafe_projects, removed_projects) = remove_project_sections(without_bom, false);
    (without_unsafe_projects, removed_bom || removed_projects)
}

pub fn parse_codex_config_doc(content: &str) -> Result<(Document, bool), String> {
    let (normalized, changed) = normalize_codex_config_input(content);
    if normalized.trim().is_empty() {
        return Ok((Document::new(), changed));
    }

    match normalized.parse::<Document>() {
        Ok(doc) => Ok((doc, changed)),
        Err(original_error) => {
            let (without_projects, removed_projects) = remove_project_sections(&normalized, true);
            if removed_projects {
                if without_projects.trim().is_empty() {
                    return Ok((Document::new(), true));
                }
                if let Ok(doc) = without_projects.parse::<Document>() {
                    return Ok((doc, true));
                }
            }
            Err(original_error.to_string())
        }
    }
}

pub fn read_codex_config_doc_from_str(content: &str) -> Result<Document, String> {
    parse_codex_config_doc(content).map(|(doc, _)| doc)
}

pub fn sanitize_codex_config_toml_file(path: &Path) -> Result<bool, String> {
    log_codex_config_audit(path, "before-sanitize");
    let changed = sanitize_codex_config_toml_file_once(path, true)?;
    let backup_path = path.with_file_name(format!(
        "{}.bak",
        path.file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("config.toml")
    ));
    let backup_changed = sanitize_codex_config_toml_file_once(&backup_path, false)?;
    let changed_any = changed || backup_changed;
    log_codex_config_audit(path, "after-sanitize");
    Ok(changed_any)
}

pub fn log_codex_config_audit(path: &Path, context: &str) {
    log_codex_config_file_audit(path, context);
    let backup_path = path.with_file_name(format!(
        "{}.bak",
        path.file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("config.toml")
    ));
    log_codex_config_file_audit(&backup_path, context);
}

fn log_codex_config_file_audit(path: &Path, context: &str) {
    match inspect_codex_config_file(path) {
        Ok(summary) => crate::modules::logger::log_info(&format!(
            "[Codex Config Audit] context={}, path={}, {}",
            context,
            path.display(),
            summary
        )),
        Err(error) => crate::modules::logger::log_warn(&format!(
            "[Codex Config Audit] context={}, path={}, error={}",
            context,
            path.display(),
            error
        )),
    }
}

fn inspect_codex_config_file(path: &Path) -> Result<String, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok("exists=false".to_string())
        }
        Err(error) => return Err(format!("read_failed={}", error)),
    };
    if content.trim().is_empty() {
        return Ok(format!("exists=true bytes={} empty=true", content.len()));
    }

    let (doc, sanitized) =
        parse_codex_config_doc(&content).map_err(|error| format!("parse_failed={}", error))?;
    let features = match doc.get(CODEX_FEATURES_KEY) {
        Some(item) if item.as_table().is_some() => "table".to_string(),
        Some(item) if item.as_value().and_then(|value| value.as_bool()).is_some() => format!(
            "bool:{}",
            item.as_value()
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        ),
        Some(item) if item.as_value().and_then(|value| value.as_str()).is_some() => {
            "string".to_string()
        }
        Some(_) => "other".to_string(),
        None => "absent".to_string(),
    };
    let model = doc
        .get(CODEX_MODEL_KEY)
        .and_then(|item| item.as_value())
        .and_then(|value| value.as_str())
        .unwrap_or("<absent>");
    let provider = doc
        .get(CODEX_MODEL_PROVIDER_KEY)
        .and_then(|item| item.as_value())
        .and_then(|value| value.as_str())
        .unwrap_or("<absent>");
    let catalog = doc
        .get(CODEX_MODEL_CATALOG_JSON_KEY)
        .and_then(|item| item.as_value())
        .and_then(|value| value.as_str())
        .unwrap_or("<absent>");
    Ok(format!(
        "exists=true bytes={} sanitized={} features={} model={} model_provider={} model_catalog_json={}",
        content.len(),
        sanitized,
        features,
        model,
        provider,
        catalog
    ))
}

fn sanitize_codex_config_toml_file_once(
    path: &Path,
    create_when_missing_or_empty: bool,
) -> Result<bool, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if create_when_missing_or_empty {
                String::new()
            } else {
                return Ok(false);
            }
        }
        Err(error) => {
            return Err(format!(
                "读取 Codex config.toml 失败 ({}): {}",
                path.display(),
                error
            ));
        }
    };
    if content.trim().is_empty() && !create_when_missing_or_empty {
        return Ok(false);
    }

    prepare_codex_config_file_for_write(path)?;

    let (mut doc, input_changed) = parse_codex_config_doc(&content).map_err(|error| {
        format!(
            "解析 Codex config.toml 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    let feature_changed = ensure_respect_system_proxy_feature(&mut doc);
    let provider_changed = ensure_gmd_relay_http_only_providers(&mut doc);
    if doc.get(CODEX_FEATURES_KEY).is_some_and(|item| {
        item.as_table().is_none() && item.as_inline_table().is_none()
    }) {
        crate::modules::logger::log_warn(&format!(
            "[Codex Config] 跳过 respect_system_proxy 注入：features 不是表结构: {}",
            path.display()
        ));
    }
    if !input_changed && !feature_changed && !provider_changed {
        return Ok(false);
    }

    let normalized = normalize_config_toml_spacing(&doc.to_string());
    write_codex_config_toml_atomic(path, &normalized).map_err(|error| {
        format!(
            "写入 Codex config.toml 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    crate::modules::logger::log_info(&format!(
        "[Codex Config] sanitized config.toml before launch: {}",
        path.display()
    ));
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{
        codex_config_doc_to_string, normalize_config_toml_spacing, parse_codex_config_doc,
        sanitize_codex_config_toml_file,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use toml_edit::Document;

    fn unique_temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cockpit-codex-config-format-{}-{}",
            std::process::id(),
            unique
        ))
    }

    #[test]
    fn collapses_repeated_blank_lines() {
        let input = "model = \"gpt-5\"\n\n\n\nsandbox_mode = \"danger-full-access\"\n\n[desktop]\n";
        let output = normalize_config_toml_spacing(input);

        assert_eq!(
            output,
            "model = \"gpt-5\"\n\nsandbox_mode = \"danger-full-access\"\n\n[desktop]\n"
        );
    }

    #[test]
    fn adds_proxy_feature_without_changing_existing_features() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = r#"
model = "deepseek-v4-pro"

[features]
memories = true
multi_agent = true
js_repl = false

[desktop]
default-service-tier = "priority"
"#;
        fs::write(&config_path, input).expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("[features]"));
        assert!(output.contains("memories = true"));
        assert!(output.contains("multi_agent = true"));
        assert!(output.contains("js_repl = false"));
        assert!(output.contains("respect_system_proxy = true"));
        assert!(output.contains("model = \"deepseek-v4-pro\""));
        assert!(output.contains("[desktop]"));

        // The launch sanitizer is idempotent and does not keep rewriting the
        // profile on every account switch.
        assert!(!sanitize_codex_config_toml_file(&config_path).expect("sanitize config twice"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_features_table_when_proxy_feature_is_missing() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        fs::write(&config_path, "model = \"gpt-5\"\n").expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("[features]"));
        assert!(output.contains("respect_system_proxy = true"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_missing_main_config_without_creating_backup() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let backup_path = dir.join("config.toml.bak");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("[features]"));
        assert!(output.contains("respect_system_proxy = true"));
        assert!(!backup_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn initializes_empty_main_config_without_creating_backup() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let backup_path = dir.join("config.toml.bak");
        fs::write(&config_path, "").expect("write empty config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("[features]"));
        assert!(output.contains("respect_system_proxy = true"));
        assert!(!backup_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leaves_legacy_scalar_features_value_unchanged() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = "model = \"gpt-5\"\nfeatures = true\n";
        fs::write(&config_path, input).expect("write config");

        assert!(!sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));
        assert_eq!(fs::read_to_string(&config_path).expect("read config"), input);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_explicit_proxy_feature_opt_out() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = "[features]\nrespect_system_proxy = false\n";
        fs::write(&config_path, input).expect("write config");

        assert!(!sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));
        assert_eq!(fs::read_to_string(&config_path).expect("read config"), input);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extends_inline_features_table() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        fs::write(&config_path, "features = { memories = true, js_repl = false }\n")
            .expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("memories = true"));
        assert!(output.contains("js_repl = false"));
        assert!(output.contains("respect_system_proxy = true"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn proxy_feature_injection_preserves_provider_configuration() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = r#"model_provider = "gmd"

[model_providers.gmd]
name = "GMD Relay"
base_url = "https://api.gmd.ink/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[features]
memories = true
js_repl = false
"#;
        fs::write(&config_path, input).expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("model_provider = \"gmd\""));
        assert!(output.contains("[model_providers.gmd]"));
        assert!(output.contains("base_url = \"https://api.gmd.ink/v1\""));
        assert!(output.contains("wire_api = \"responses\""));
        assert!(output.contains("requires_openai_auth = false"));
        assert!(output.contains("supports_websockets = false"));
        assert!(output.contains("memories = true"));
        assert!(output.contains("js_repl = false"));
        assert!(output.contains("respect_system_proxy = true"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disables_websockets_for_gmd_provider_without_changing_endpoint() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = r#"model_provider = "OpenAI"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://subapi.gmd.ink/v1"
wire_api = "responses"
requires_openai_auth = false
custom_flag = "keep-me"

[features]
respect_system_proxy = true
"#;
        fs::write(&config_path, input).expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        assert!(output.contains("base_url = \"https://subapi.gmd.ink/v1\""));
        assert!(output.contains("custom_flag = \"keep-me\""));
        assert!(output.contains("supports_websockets = false"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disables_stale_gmd_websocket_capability_but_preserves_other_provider() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let input = r#"[model_providers.gmd]
base_url = "https://api.gmd.ink/v1"
wire_api = "responses"
supports_websockets = true

[model_providers.other]
base_url = "https://relay.example.com/v1"
wire_api = "responses"
supports_websockets = true

[features]
respect_system_proxy = true
"#;
        fs::write(&config_path, input).expect("write config");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let output = fs::read_to_string(&config_path).expect("read config");
        let gmd_start = output.find("[model_providers.gmd]").expect("gmd provider");
        let other_start = output
            .find("[model_providers.other]")
            .expect("other provider");
        let gmd = &output[gmd_start..other_start];
        let other = &output[other_start..];
        assert!(gmd.contains("supports_websockets = false"));
        assert!(other.contains("supports_websockets = true"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_boolean_features_value() {
        let mut doc = r#"
model = "gpt-5"
features = true
"#
        .parse::<Document>()
        .expect("parse config");

        let output = codex_config_doc_to_string(&mut doc);
        assert!(output.contains("features = true"));
    }

    #[test]
    fn parse_removes_utf8_bom() {
        let (doc, changed) =
            parse_codex_config_doc("\u{feff}model = \"gpt-5\"\n").expect("parse config");

        assert!(changed);
        assert_eq!(
            doc.get("model").and_then(|item| item.as_str()),
            Some("gpt-5")
        );
    }

    #[test]
    fn parse_removes_non_ascii_project_sections() {
        let input = "model = \"gpt-5\"\n\n[projects.'C:\\Users\\demo\\赚钱']\ntrust_level = \"trusted\"\n\n[mcp_servers.demo]\ncommand = \"node\"\n";
        let (doc, changed) = parse_codex_config_doc(input).expect("parse config");
        let output = doc.to_string();

        assert!(changed);
        assert!(output.contains("model = \"gpt-5\""));
        assert!(output.contains("[mcp_servers.demo]"));
        assert!(!output.contains("[projects."));
        assert!(!output.contains("trust_level"));
    }

    #[test]
    fn parse_removes_unicode_escape_project_sections() {
        let input = "model = \"gpt-5\"\n\n[projects.\"C:\\\\Users\\\\demo\\\\GitHub\\u8d5a\\u94b1\"]\ntrust_level = \"trusted\"\n";
        let (doc, changed) = parse_codex_config_doc(input).expect("parse config");
        let output = doc.to_string();

        assert!(changed);
        assert!(output.contains("model = \"gpt-5\""));
        assert!(!output.contains("[projects."));
    }

    #[test]
    fn parse_keeps_ascii_project_sections() {
        let input = "model = \"gpt-5\"\n\n[projects.\"C:\\\\Users\\\\demo\\\\repo\"]\ntrust_level = \"trusted\"\n";
        let (doc, changed) = parse_codex_config_doc(input).expect("parse config");
        let output = doc.to_string();

        assert!(!changed);
        assert!(output.contains("[projects.\"C:\\\\Users\\\\demo\\\\repo\"]"));
        assert!(output.contains("trust_level = \"trusted\""));
    }

    #[test]
    fn parse_falls_back_by_removing_all_projects_when_project_body_is_invalid() {
        let input = "model = \"gpt-5\"\n\n[projects.\"C:\\\\Users\\\\demo\\\\repo\"]\ntrust_level = \"trusted\n\n[mcp_servers.demo]\ncommand = \"node\"\n";
        let (doc, changed) = parse_codex_config_doc(input).expect("parse config");
        let output = doc.to_string();

        assert!(changed);
        assert!(output.contains("model = \"gpt-5\""));
        assert!(output.contains("[mcp_servers.demo]"));
        assert!(!output.contains("[projects."));
    }

    #[test]
    fn sanitizes_backup_file_next_to_config() {
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let config_path = dir.join("config.toml");
        let backup_path = dir.join("config.toml.bak");

        // Keep the main file idempotent so this test isolates sanitizing an
        // already-existing backup. If the main file changes, the atomic writer
        // correctly refreshes `.bak` from the pre-write main content first.
        fs::write(
            &config_path,
            "model = \"gpt-5\"\n\n[features]\nrespect_system_proxy = true\n",
        )
        .expect("write config");
        fs::write(
            &backup_path,
            "\u{feff}model = \"gpt-5\"\n\n[features]\nmemories = true\njs_repl = false\n",
        )
        .expect("write backup");

        assert!(sanitize_codex_config_toml_file(&config_path).expect("sanitize config"));

        let backup = fs::read_to_string(&backup_path).expect("read backup");
        assert!(!backup.starts_with('\u{feff}'));
        assert!(backup.contains("[features]"));
        assert!(backup.contains("memories = true"));
        assert!(backup.contains("model = \"gpt-5\""));

        let _ = fs::remove_dir_all(&dir);
    }
}
