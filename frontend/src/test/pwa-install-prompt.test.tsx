import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';
import { PwaInstallProvider } from '../components/PwaInstallProvider';

const setUserAgent = (value: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value,
    configurable: true,
  });
};

const fireBeforeInstallPrompt = (prompt: () => Promise<void>, userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>) => {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperty(event, 'platforms', { value: ['web'] });
  Object.defineProperty(event, 'prompt', { value: prompt });
  Object.defineProperty(event, 'userChoice', { value: userChoice });
  window.dispatchEvent(event);
};

const renderPrompt = () =>
  render(
    <PwaInstallProvider>
      <PwaInstallPrompt />
    </PwaInstallProvider>,
  );

describe('PwaInstallPrompt', () => {
  afterEach(() => {
    window.localStorage.clear();
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36');
  });

  it('renders nothing by default', () => {
    renderPrompt();
    expect(screen.queryByLabelText('安装 Meno 应用提示')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('将 Meno 添加到主屏幕')).not.toBeInTheDocument();
  });

  it('shows the install card when installable and installs on click', async () => {
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' });
    renderPrompt();

    act(() => fireBeforeInstallPrompt(prompt, userChoice));

    const installButton = await screen.findByRole('button', { name: '安装' });
    expect(screen.getByLabelText('安装 Meno 应用提示')).toBeInTheDocument();

    fireEvent.click(installButton);

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('安装 Meno 应用提示')).not.toBeInTheDocument());
  });

  it('hides the install card when dismissed', async () => {
    renderPrompt();
    act(() => fireBeforeInstallPrompt(vi.fn(async () => undefined), Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })));

    const close = await screen.findByLabelText('关闭安装提示');
    fireEvent.click(close);

    expect(screen.queryByLabelText('安装 Meno 应用提示')).not.toBeInTheDocument();
  });

  it('shows the iOS add-to-home-screen sheet and persists dismissal', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    const first = renderPrompt();
    const dialog = await screen.findByLabelText('将 Meno 添加到主屏幕');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.queryByLabelText('将 Meno 添加到主屏幕')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('meno:pwa-ios-dismissed')).toBe('true');

    first.unmount();

    renderPrompt();
    expect(screen.queryByLabelText('将 Meno 添加到主屏幕')).not.toBeInTheDocument();
  });
});
