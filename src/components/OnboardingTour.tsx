import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check, CircleHelp, X } from 'lucide-react';
import './OnboardingTour.css';

const ONBOARDING_STORAGE_KEY = 'gmd.onboarding.completed.v1';

interface TourStep {
  selector: string;
  page?: string;
  title: string;
  description: string;
}

const TOUR_STEPS: readonly TourStep[] = [
  {
    selector: '[data-tour="brand"]',
    page: 'dashboard',
    title: '认识 GMD 账号管理',
    description: '这里是 GMD 账号管理的品牌入口。点击左侧导航可以在仪表盘、平台账号和设置之间切换。',
  },
  {
    selector: '[data-tour="nav-platforms"]',
    page: 'dashboard',
    title: '统一平台导航',
    description: '已接入的平台会集中显示在这里；平台较多时可打开“更多平台”，并按你的工作习惯调整布局。',
  },
  {
    selector: '[data-tour="dashboard-nav"]',
    page: 'dashboard',
    title: '从仪表盘开始',
    description: '仪表盘汇总账号数量、当前账号和配额状态。点击左侧仪表盘入口即可回到总览。',
  },
  {
    selector: '[data-tour="gmd-relay-config"]',
    page: 'api-relay',
    title: '配置 GMD 中转站',
    description: '输入 subapi.gmd.ink 或 api.gmd.ink 对应的 URL 和 API Key，保存后即可读取额度、请求统计和可用模型。',
  },
  {
    selector: '[data-tour="codex-nav"]',
    page: 'codex',
    title: 'Codex 启动前选择模型',
    description: '打开 Codex 账号页后，点击启动按钮即可在启动前选择模型；选择会按账号保存，避免进入 CLI 后再输入切换命令。',
  },
  {
    selector: '[data-tour="settings-nav"]',
    page: 'settings',
    title: '设置与教程入口',
    description: '在设置中可以调整主题、启动页、自动刷新等偏好，也可以随时重新打开本教程。',
  },
];

interface OnboardingTourProps {
  version?: number;
}

function hasCompleted(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markCompleted(): void {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch {
    // Private browsing or a locked storage area should not block the UI.
  }
}

function requestPage(page?: string): void {
  if (!page) return;
  window.dispatchEvent(new CustomEvent('app-request-navigate', { detail: page }));
}

export function OnboardingTour({ version = 1 }: OnboardingTourProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const steps = useMemo(
    () => TOUR_STEPS.map((step) => ({
      ...step,
      title: t(`onboarding.steps.${TOUR_STEPS.indexOf(step)}.title`, step.title),
      description: t(`onboarding.steps.${TOUR_STEPS.indexOf(step)}.description`, step.description),
    })),
    [t],
  );
  const currentStep = steps[stepIndex] ?? steps[0];

  const close = useCallback((complete: boolean) => {
    if (complete) markCompleted();
    setOpen(false);
  }, []);

  const goToStep = useCallback((nextIndex: number) => {
    const bounded = Math.max(0, Math.min(steps.length - 1, nextIndex));
    setStepIndex(bounded);
    requestPage(steps[bounded]?.page);
  }, [steps]);

  useEffect(() => {
    void version;
    const timer = window.setTimeout(() => {
      if (!hasCompleted()) {
        setStepIndex(0);
        setOpen(true);
      }
    }, 550);
    const handleOpen = () => {
      setStepIndex(0);
      setOpen(true);
      requestPage(TOUR_STEPS[0]?.page);
    };
    window.addEventListener('gmd-open-onboarding', handleOpen);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('gmd-open-onboarding', handleOpen);
    };
  }, [version]);

  useEffect(() => {
    if (!open || !currentStep) return undefined;
    requestPage(currentStep.page);
    let frame = 0;
    let attempts = 0;
    const update = () => {
      const target = document.querySelector(currentStep.selector);
      setTargetRect(target instanceof HTMLElement ? target.getBoundingClientRect() : null);
      attempts += 1;
      if (!target && attempts < 20) {
        frame = window.requestAnimationFrame(update);
      }
    };
    frame = window.requestAnimationFrame(update);
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [currentStep, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToStep(stepIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToStep(stepIndex - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, goToStep, open, stepIndex]);

  if (!open || !currentStep) return null;

  const padding = 8;
  const spotlight = targetRect
    ? {
        top: Math.max(8, targetRect.top - padding),
        left: Math.max(8, targetRect.left - padding),
        width: Math.min(window.innerWidth - 16, targetRect.width + padding * 2),
        height: Math.min(window.innerHeight - 16, targetRect.height + padding * 2),
      }
    : null;
  const cardWidth = Math.min(380, Math.max(280, window.innerWidth - 32));
  const cardLeft = spotlight
    ? Math.max(16, Math.min(window.innerWidth - cardWidth - 16, spotlight.left + spotlight.width / 2 - cardWidth / 2))
    : Math.max(16, (window.innerWidth - cardWidth) / 2);
  const cardTop = spotlight
    ? spotlight.top + spotlight.height + 18 + 220 < window.innerHeight
      ? spotlight.top + spotlight.height + 18
      : Math.max(16, spotlight.top - 238)
    : Math.max(16, (window.innerHeight - 250) / 2);

  return createPortal(
    <div className="gmd-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="gmd-onboarding-title">
      <div className="gmd-onboarding-scrim" />
      {spotlight && <div className="gmd-onboarding-spotlight" style={spotlight} aria-hidden="true" />}
      <section
        className="gmd-onboarding-card"
        style={{ width: `${cardWidth}px`, left: `${cardLeft}px`, top: `${cardTop}px` }}
      >
        <div className="gmd-onboarding-card-header">
          <div className="gmd-onboarding-step-icon"><CircleHelp size={18} /></div>
          <span className="gmd-onboarding-kicker">
            {t('onboarding.kicker', 'GMD 新手教程')}
          </span>
          <button
            type="button"
            className="gmd-onboarding-close"
            onClick={() => close(true)}
            aria-label={t('common.close', '关闭')}
            title={t('common.close', '关闭')}
          >
            <X size={16} />
          </button>
        </div>
        <h2 id="gmd-onboarding-title">{currentStep.title}</h2>
        <p>{currentStep.description}</p>
        <div className="gmd-onboarding-progress" aria-label={`${stepIndex + 1}/${steps.length}`}>
          {steps.map((item, index) => (
            <span key={item.selector} className={index === stepIndex ? 'is-active' : index < stepIndex ? 'is-complete' : ''} />
          ))}
          <span className="gmd-onboarding-progress-text">{stepIndex + 1} / {steps.length}</span>
        </div>
        <div className="gmd-onboarding-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(true)}>
            {t('onboarding.skip', '跳过')}
          </button>
          <div className="gmd-onboarding-nav-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goToStep(stepIndex - 1)}
              disabled={stepIndex === 0}
              title={t('onboarding.previous', '上一步')}
            >
              <ArrowLeft size={15} />
              <span>{t('onboarding.previous', '上一步')}</span>
            </button>
            {stepIndex < steps.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => goToStep(stepIndex + 1)}>
                <span>{t('onboarding.next', '下一步')}</span>
                <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => close(true)}>
                <Check size={15} />
                <span>{t('onboarding.finish', '完成')}</span>
              </button>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
