# Notice

The workflow structure (evidence bar, coverage ledger, fresh-verifier rule, profiles, verdict branches) and the
generic JSON-schema interpreter in `validate-findings.cjs` / `validate-coverage-ledger.cjs` are adapted from
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill), used under the MIT License:

```
MIT License

Copyright (c) 2025-2026 Cloudflare, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Changes from upstream: the security domains are removed; the findings schema is rewritten for code-health dimensions
(D2–D12, impact/likelihood/priority/effort); the ledger is simplified to subsystem × dimension units; file reads use
a portable lstat-based guard because `O_NOFOLLOW` is unavailable on Windows (the upstream validators refuse to run there).
