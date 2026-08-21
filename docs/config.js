// Configuration du site vitrine — À AJUSTER une seule fois.
// owner/repo = le dépôt PUBLIC (releases + issues + ce site).
window.RUBIDESK = {
  owner: "Sh1v4x",
  repo: "rubidesk",
  // URL du Worker Cloudflare (report de bug sans compte GitHub), même
  // mécanisme que le worker d'Eliadex — déployer un jumeau « rubidesk-bug »
  // avec un token GitHub fine-grained limité aux issues de ce dépôt.
  // Vide = repli sur l'issue GitHub pré-remplie (compte requis).
  bugEndpoint: "",
};
