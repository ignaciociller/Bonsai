// Aplica el tema antes de pintar para evitar parpadeos.
(function () {
  try {
    var t = localStorage.getItem('bonsai.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* almacenamiento no disponible */ }
})();
