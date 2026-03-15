import '../styles/onboarding.scss';

document.addEventListener('DOMContentLoaded', () => {
  // スムーススクロールなどの簡単な処理を追加できます
  const links = document.querySelectorAll('a[href^="#"]');
  links.forEach((link) => {
    link.addEventListener('click', function (this: HTMLAnchorElement, e) {
      e.preventDefault();
      const targetId = this.getAttribute('href')?.substring(1);
      const targetElement = targetId ? document.getElementById(targetId) : null;

      if (targetElement) {
        window.scrollTo({
          top: targetElement.offsetTop - 20,
          behavior: 'smooth',
        });
      }
    });
  });
});
