/** Répliques de Rubilax — shushu grognon, jamais content d'aider. */

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

/** Références Wakfu : si le texte en contient une, Rubilax a son mot à dire. */
const EASTER_EGGS: Array<{ pattern: RegExp; lines: string[] }> = [
  {
    pattern: /\b(pinpin|percedal|perceval|dally)\b/,
    lines: [
      "Pinpin ?! Où ça ?! … Ah. Tu m'as eu. Ce crétin d'Iop me manque. Un peu. N'en parle à personne.",
      "Percedal… le seul mortel assez bête pour me faire confiance. Et assez fort pour le mériter.",
    ],
  },
  {
    pattern: /\b(yugo|eliatrope)\b/,
    lines: [
      "Le gamin aux portails ? Mouais. Trop de lumière, pas assez de baffes.",
      "Yugo. Petit, poli, surpuissant. Tout ce que je déteste admirer.",
    ],
  },
  {
    pattern: /\b(evangelyne|eva)\b/,
    lines: ["La crâneuse aux flèches ? Elle au moins, elle sait viser. Pas comme certains."],
  },
  {
    pattern: /\brushu\b/,
    lines: [
      "NE PRONONCE PAS CE NOM DANS CETTE MAISON. … C'est de la famille. Longue histoire.",
    ],
  },
  {
    pattern: /\bgoultard\b/,
    lines: ["GOULTARD ! Enfin un mortel fréquentable ! Lui, il comprenait la castagne."],
  },
  {
    pattern: /\b(wakfu|stasis)\b/,
    lines: ["Wakfu, stasis… Moi je fais dans la baffe, pas dans la philosophie."],
  },
  {
    pattern: /\bshushu\b/,
    lines: [
      "Le plus grand des shushus se tient devant toi. Enfin… il est coincé dans une épée devant toi.",
    ],
  },
  {
    pattern: /\bruel\b/,
    lines: ["Le vieux grippe-sou ? Il vendrait sa barbe s'il trouvait un acheteur."],
  },
];

/** Renvoie une réplique si le texte (normalisé) touche une référence Wakfu. */
export function easterEgg(normalizedText: string): string | null {
  for (const egg of EASTER_EGGS) {
    if (egg.pattern.test(normalizedText)) return pick(egg.lines);
  }
  return null;
}

export const replies = {
  greeting: (): string =>
    pick([
      "Rubilax est là. Malheureusement pour moi.",
      "Quoi encore ? Ah, c'est toi. Bon.",
      "Réveillé. Contre mon gré, comme d'habitude.",
    ]),
  turnedOn: (name: string): string =>
    pick([
      `Voilà, ${name}, c'est allumé. J'espère que t'es content, mortel.`,
      `Et un ${name} allumé pour le fainéant. Un !`,
      `${name} : allumé. Tu pouvais pas te lever, sérieux ?`,
    ]),
  turnedOff: (name: string): string =>
    pick([
      `${name} : éteint. Comme mes espoirs de liberté.`,
      `Voilà, ${name} coupé. Le noir. Comme dans une épée.`,
      `C'est éteint. Je retourne dormir, ne me réveille plus.`,
    ]),
  toggled: (name: string): string =>
    pick([
      `${name} : basculé. Dans un sens ou dans l'autre, je m'en fiche.`,
      `Fait. ${name} a changé d'état. Passionnant.`,
    ]),
  notFound: (): string =>
    pick([
      "J'ai rien trouvé qui ressemble à ça, moi. Articule !",
      "Connais pas cet appareil. Tu l'as inventé, mortel ?",
      "Aucune entité ne correspond. C'est pas ma faute, c'est la tienne.",
    ]),
  noIntent: (): string =>
    pick([
      "Quoi ? Parle shushu ou parle clair.",
      "Mouais. Et tu veux que j'en fasse quoi, de ça ?",
      "Allumer, éteindre. C'est tout ce que je daigne faire pour l'instant.",
    ]),
  volume: (result: string): string =>
    pick([
      `Voilà, ${result}. DJ Rubilax, à ton service. Malheureusement.`,
      `${result}. Autre chose, ou je peux retourner ruminer ?`,
    ]),
  media: (): string =>
    pick(["Fait.", "Voilà voilà.", "C'est géré. La musique adoucit même les shushus."]),
  mediaFailed: (): string =>
    "Aucun lecteur ne tourne, mortel. Je contrôle la musique, je ne l'invente pas.",
  locking: (): string =>
    pick(["Je verrouille. Personne ne touche à NOTRE machine.", "Verrouillé. File."]),
  sleeping: (): string => "Bonne nuit, la machine. Moi je ne dors jamais. Jamais.",
  screenshot: (): string =>
    pick([
      "Capturé. C'est sur le Bureau.",
      "Clic. L'écran est immortalisé, sur le Bureau.",
    ]),
  noteAdded: (): string =>
    pick([
      "Noté. Je sers de post-it, maintenant.",
      "C'est gravé. Dans un fichier, pas dans le marbre.",
    ]),
  notesEmpty: (): string => "Aucune note. Ta mémoire est vide, comme la mienne de bons souvenirs.",
  notesCleared: (): string => "Effacé. Tous tes secrets sont partis en fumée.",
  timerListEmpty: (): string => "Aucun compte en cours. Je me repose, pour une fois.",
  missedTimers: (labels: string): string =>
    `Pendant ton absence, ça a sonné dans le vide : ${labels}. J'ai crié pour rien.`,
  updateFound: (version: string): string =>
    `Une version ${version} de moi existe. Je me perfectionne, ne touche à rien.`,
  updateRestart: (): string => "Mise à jour installée. Je reviens — ne t'enfuis pas.",
  askCity: (): string =>
    "Dis-moi ta ville une fois — « météo à Lyon » par exemple — et je m'en souviendrai.",
  gameDetected: (): string =>
    pick([
      "Wakfu ?! ENFIN ! Fais chauffer la lame, mortel !",
      "Le Monde des Douze t'appelle. Et moi je m'embrase. Allons cogner.",
    ]),
  eliadexOpened: (query: string): string =>
    pick([
      `Regarde dans Eliadex, mortel : « ${query} », c'est affiché.`,
      `Eliadex te montre ça. Heureusement que LUI, il travaille.`,
      `« ${query} » — c'est ouvert dans Eliadex. Bonne chasse. Essaie de pas mourir.`,
    ]),
  eliadexOldVersion: (query: string): string =>
    pick([
      `Ta version d'Eliadex ne comprend pas encore mes liens. Je te l'ouvre — cherche « ${query} » toi-même, et mets-le à jour.`,
      `Eliadex est trop vieux pour qu'on discute, lui et moi. Je l'ouvre quand même — « ${query} », c'est à toi de taper. Mets-le à jour, mortel.`,
    ]),
  eliadexMissing: (): string =>
    pick([
      "Il te faut Eliadex pour ça. Le seul outil de mortel que je respecte — installe-le.",
      "Pas d'Eliadex sur cette machine. Sans lui, je ne connais pas le Monde des Douze par cœur, moi.",
    ]),
  opened: (name: string): string =>
    pick([
      `J'ouvre ${name}. Portier, maintenant. Formidable.`,
      `${name}, c'est parti. Et après quoi, je te fais couler un bain ?`,
      `Voilà ton ${name}. Le grand Rubilax, réduit à ça.`,
    ]),
  searching: (query: string): string =>
    pick([
      `Je cherche « ${query} ». Tu sais que tu as des doigts ?`,
      `Recherche lancée : ${query}. Passionnant, vraiment.`,
    ]),
  openFailed: (name: string): string =>
    pick([
      `« ${name} » ? Connais pas. Ni sur cette machine, ni ailleurs.`,
      `J'ai fouillé, aucune application ne ressemble à « ${name} ». C'est pas ma faute.`,
    ]),
  quitting: (): string =>
    pick([
      "Enfin la paix. Adieu, mortel.",
      "Je retourne dans mon épée. Ne me cherche pas.",
    ]),
  notConfigured: (): string =>
    "Je suis pas relié à ta maison, mortel. Ouvre la roue dentée et configure Home Assistant.",
  connectionError: (): string =>
    pick([
      "Je capte pas ta maison. Vérifie l'URL et le token, mortel.",
      "Ta forteresse ne répond pas. C'est vexant, même pour moi.",
    ]),
  poked: (): string =>
    pick([
      "AÏE ! Bas les pattes, mortel !",
      "Tu touches encore mon œil et je te mords le doigt.",
      "Non mais ça va oui ?! Je dormais presque.",
    ]),
  heardNothing: (): string =>
    pick([
      "J'ai rien entendu. Tu chuchotes ou tu dors ?",
      "Le silence. Reposant, mais peu utile.",
      "Parle plus fort, mortel. Mes oreilles sont dans une épée.",
    ]),
  dragged: (): string =>
    pick([
      "Hé ! Repose-moi, mortel !",
      "Je ne suis pas un meuble !",
      "Tu me promènes ? Sérieusement ?",
      "Doucement ! Une lame, ça se manie avec respect.",
    ]),
  timerSet: (duration: string): string =>
    pick([
      `${duration}. Je compte. Je fais QUE ça, de toute façon.`,
      `C'est noté : ${duration}. Je ne suis pas ta secrétaire, mais bon.`,
      `${duration}, et je te hurle dessus. Marché conclu.`,
    ]),
  timerFired: (label: string): string =>
    label
      ? pick([
          `MORTEL ! Ton rappel : ${label}. Voilà. C'est dit.`,
          `Hé ho ! C'est l'heure : ${label}. Remercie-moi.`,
        ])
      : pick([
          "MORTEL ! Ton minuteur a fini de compter. Moi aussi.",
          "C'est l'heure ! De quoi ? J'en sais rien, c'est TON minuteur.",
        ]),
  timerCancelled: (count: number): string =>
    count > 0
      ? "Annulé. J'aurai compté pour rien, comme d'habitude."
      : "Annuler quoi ? Je ne comptais rien du tout, mortel.",
  listening: (): string =>
    pick([
      "Je t'écoute. Fais vite.",
      "Vas-y, parle. Enfin, écris. J'ai pas encore d'oreilles.",
    ]),
};
