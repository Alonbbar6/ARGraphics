---
name: Tailwind token collisions
description: Non-obvious Tailwind v4 interaction between named spacing tokens and max-width utilities.
---

Do not introduce spacing tokens named `sm`, `md`, `lg`, `xl`, or their larger variants without checking their effect on container-width utilities.

**Why:** Tailwind v4 generated `max-w-lg` using the named spacing token rather than the container token. This collapsed dialogs and paragraphs into narrow strips despite valid typechecks.

**How to apply:** Use a distinct spacing-token namespace in future theme work. When preserving an existing public design, fix container widths within the affected owner scope rather than making a broad global token change. Verify actual compiled CSS and rendered dialog widths.
