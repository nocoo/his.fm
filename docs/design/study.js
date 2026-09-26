for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    const section = button.closest('.cover-section');
    for (const item of section.querySelectorAll('[data-mode]')) item.setAttribute('aria-pressed', String(item === button));
    for (const cover of section.querySelectorAll('.cover-grid .cover-composition')) cover.dataset.layer = button.dataset.mode;
  });
}

let toastTimer;
for (const swatch of document.querySelectorAll('[data-copy]')) {
  swatch.addEventListener('click', async () => {
    const toast = document.querySelector('.toast');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(swatch.dataset.copy);
      toast.textContent = `已复制 ${swatch.dataset.copy}`;
    } catch {
      toast.textContent = `色值：${swatch.dataset.copy}（可直接选择复制）`;
    }
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
  });
}
