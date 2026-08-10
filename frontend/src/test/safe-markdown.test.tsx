import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from '../components/SafeMarkdown';

describe('SafeMarkdown', () => {
  it('does not turn raw HTML and event attributes into executable DOM', () => {
    const { container } = render(
      <SafeMarkdown content={'<img src="x" onerror="alert(1)"><iframe srcdoc="<script>alert(1)</script>"></iframe><script>alert(1)</script>\n\n安全文本'} />,
    );

    expect(container.querySelector('script, iframe, img[onerror], [srcdoc]')).toBeNull();
    expect(screen.getByText('安全文本')).toBeInTheDocument();
  });

  it('rejects javascript links and allows ordinary https links', () => {
    const { container } = render(
      <SafeMarkdown content={'[危险](javascript:alert(1))\n\n[安全](https://example.com)'} />,
    );

    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href="https://example.com"]')).toBeInTheDocument();
  });
});
