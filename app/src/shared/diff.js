// Compara lo que dijiste con lo que se pegó, palabra por palabra.
// Se usa en el proceso principal (estadísticas) y en la ventana de ajustes
// (para tachar muletillas y repeticiones en "Tu último dictado").
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VFDiff = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(word) {
    return word
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  function words(text) {
    return String(text || '')
      .split(/\s+/)
      .filter(Boolean);
  }

  // Devuelve las palabras de `raw` marcadas como conservadas o quitadas.
  function removedWords(raw, final) {
    const a = words(raw);
    const b = words(final).map(norm).filter(Boolean);
    const an = a.map(norm);
    const n = a.length;
    const m = b.length;
    if (!n) return [];
    if (n * m > 400000) return a.map((w) => ({ word: w, removed: false }));

    // Subsecuencia común más larga
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = an[i] && an[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n) {
      if (!an[i]) {
        out.push({ word: a[i], removed: false });
        i++;
      } else if (j < m && an[i] === b[j]) {
        out.push({ word: a[i], removed: false });
        i++;
        j++;
      } else if (j < m && dp[i][j + 1] >= dp[i + 1][j]) {
        j++;
      } else {
        out.push({ word: a[i], removed: true });
        i++;
      }
    }
    return out;
  }

  function countWords(text) {
    return words(text).filter((w) => norm(w)).length;
  }

  return { removedWords, countWords };
});
