#!/usr/bin/env node

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const ANSI = {
    reset: '\x1b[0m',
    dim: '\x1b[2;90m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    yellow: '\x1b[33m',
  };

  const paint = (color, text) => `${color}${text}${ANSI.reset}`;

  const formatTokens = (n) => {
    if (!Number.isFinite(n) || n < 0) return '--';
    if (n < 1000) return `${n}`;
    if (n < 100_000) {
      const v = (n / 1000).toFixed(1);
      return `${v.endsWith('.0') ? v.slice(0, -2) : v}k`;
    }
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  };

  try {
    const data = JSON.parse(input);

    const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || '--';
    const model = (data.model && data.model.display_name)
      || (data.model && data.model.id)
      || data.display_name
      || data.id
      || '--';

    const ctx = data.context_window || {};
    const cu = ctx.current_usage;
    let tokens = null;
    if (cu) {
      tokens = (cu.input_tokens || 0)
        + (cu.output_tokens || 0)
        + (cu.cache_creation_input_tokens || 0)
        + (cu.cache_read_input_tokens || 0);
    } else if (ctx.used_percentage != null && ctx.context_window_size) {
      tokens = Math.round(ctx.context_window_size * ctx.used_percentage / 100);
    }
    const tokenStr = tokens == null ? '--' : formatTokens(tokens);

    const sid = data.session_id || '--';
    const sep = paint(ANSI.dim, ' · ');

    const segments = [
      `📂 ${paint(ANSI.cyan, cwd)}`,
      `🤖 ${paint(ANSI.magenta, model)}`,
      `🧠 ${paint(ANSI.yellow, tokenStr)}`,
      paint(ANSI.dim, `#${sid}`),
    ];

    process.stdout.write(segments.join(sep));
  } catch (e) {
    process.stdout.write('statusline error');
  }
});
