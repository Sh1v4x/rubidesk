<div align="center">

# Rubilax

**Le shushu le plus grognon du Monde des Douze, posé sur ton bureau.**
Compagnon animé, commande vocale 100 % locale, domotique, minuteurs & lanceur d'apps — Windows & macOS.

<br>

[![Version](https://img.shields.io/github/v/release/Sh1v4x/rubilax?style=for-the-badge&label=version&labelColor=141a10&color=b9d456)](https://github.com/Sh1v4x/rubilax/releases/latest)
![Windows](https://img.shields.io/badge/Windows-x64-b9d456?style=for-the-badge&labelColor=141a10&logo=windows11&logoColor=b9d456)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-b9d456?style=for-the-badge&labelColor=141a10&logo=apple&logoColor=b9d456)
![Tauri](https://img.shields.io/badge/Tauri-v2-f0a24f?style=for-the-badge&labelColor=141a10&logo=tauri&logoColor=f0a24f)

<br>

<a href="https://github.com/Sh1v4x/rubilax/releases/latest"><img src="https://api.iconify.design/lucide:download.svg?color=%23b9d456&width=18" align="top"> <b>Télécharger</b></a>
&nbsp;·&nbsp;
<a href="https://github.com/Sh1v4x/rubilax/issues/new"><img src="https://api.iconify.design/lucide:bug.svg?color=%23b9d456&width=18" align="top"> <b>Signaler un bug</b></a>

</div>

---

## <img src="https://api.iconify.design/lucide:sparkles.svg?color=%23f0a24f&width=26" align="top"> Fonctionnalités

|  |  |
|:--|:--|
| <img src="https://api.iconify.design/lucide:eye.svg?color=%23b9d456&width=18" align="top"> **Le Fendoir, vivant** <br> Épée-shushu animée en fenêtre transparente *always-on-top* : 8 humeurs (repos, écoute, réflexion, colère…), clignements, braises — et son œil te suit partout sur l'écran. | <img src="https://api.iconify.design/lucide:mic.svg?color=%23b9d456&width=18" align="top"> **Voix 100 % locale** <br> Reconnaissance vocale whisper.cpp embarquée (large-v3-turbo, GPU Metal sur Mac) : aucune donnée n'est envoyée sur Internet. |
| <img src="https://api.iconify.design/lucide:flame.svg?color=%23b9d456&width=18" align="top"> **Mot d'éveil** <br> Dis « Hé Rubilax » et il se réveille — de mauvaise humeur, évidemment. Écoute passive ultra-légère (modèle tiny), désactivable d'un clic. | <img src="https://api.iconify.design/lucide:home.svg?color=%23b9d456&width=18" align="top"> **Domotique Home Assistant** <br> « Allume la lumière du salon », « éteins le ventilo » — matching flou des entités, commandes vocales ou écrites. |
| <img src="https://api.iconify.design/lucide:alarm-clock.svg?color=%23b9d456&width=18" align="top"> **Minuteurs & rappels** <br> « Rappelle-moi dans 20 minutes de sortir le four » — il compte (même après un redémarrage), puis il te hurle dessus. « Mes minuteurs » pour lister les comptes en cours. | <img src="https://api.iconify.design/lucide:rocket.svg?color=%23b9d456&width=18" align="top"> **Lanceur d'apps & web** <br> « Ouvre Spotify », « va sur youtube.com », « recherche recette tartiflette » — matching flou des applications installées. |
| <img src="https://api.iconify.design/lucide:sliders-horizontal.svg?color=%23b9d456&width=18" align="top"> **Contrôle de la machine** <br> « Baisse le son », « mets pause », « musique suivante », « verrouille l'écran », « capture d'écran », « mets le PC en veille ». | <img src="https://api.iconify.design/lucide:cloud-sun.svg?color=%23b9d456&width=18" align="top"> **Météo, notes & mises à jour auto** <br> « Quel temps demain ? » (Open-Meteo, sans compte), « note que… » / « lis mes notes », et l'app se met à jour toute seule à chaque release. |
| <img src="https://api.iconify.design/lucide:keyboard.svg?color=%23b9d456&width=18" align="top"> **Toujours à portée** <br> Raccourci global <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>, icône dans la barre des menus, lancement au démarrage optionnel, position mémorisée. | <img src="https://api.iconify.design/lucide:message-circle.svg?color=%23b9d456&width=18" align="top"> **Un vrai caractère** <br> Répliques de shushu grognon, réactions quand on le déplace ou qu'on touche son œil, mode mini, easter eggs Wakfu — parle-lui de Pinpin. |

---

## <img src="https://api.iconify.design/lucide:download.svg?color=%23f0a24f&width=26" align="top"> Installation

Télécharge la dernière version depuis la **[page des releases](https://github.com/Sh1v4x/rubilax/releases/latest)** :

| Plateforme | Fichier |
|:--|:--|
| <img src="https://api.iconify.design/lucide:monitor.svg?color=%23b9d456&width=16" align="top"> **Windows** (x64) | `Rubilax_x.y.z_x64-setup.exe` |
| <img src="https://api.iconify.design/lucide:apple.svg?color=%23b9d456&width=16" align="top"> **macOS** (Apple Silicon) | `Rubilax_x.y.z_aarch64.dmg` |

> [!NOTE]
> Rubilax est distribué **sans certificat de signature payant** : ton système peut afficher un avertissement à la première ouverture — c'est normal pour un outil indépendant, sans risque pour ta machine.
>
> - **Windows** : clique sur *Informations complémentaires* → *Exécuter quand même*.
> - **macOS** : *clic droit* sur l'app → *Ouvrir* → *Ouvrir*.

> [!TIP]
> Au premier usage du micro, Rubilax télécharge ses « oreilles » (modèles whisper, ~580 Mo au total) — une seule fois, puis tout fonctionne hors connexion.

---

## <img src="https://api.iconify.design/lucide:home.svg?color=%23f0a24f&width=26" align="top"> Connecter Home Assistant

1. Dans Home Assistant : profil → **Sécurité** → **Jetons d'accès longue durée** → *Créer un jeton*.
2. Dans Rubilax : engrenage ⚙️ → colle l'**URL** de ton instance (ex. `http://homeassistant.local:8123`) et le **jeton** → *Tester*.
3. Parle-lui : « allume la lumière du salon », « éteins le ventilateur »…

Sans Home Assistant, tout le reste (voix, minuteurs, apps, web) fonctionne normalement.

---

## <img src="https://api.iconify.design/lucide:wrench.svg?color=%23f0a24f&width=26" align="top"> Développement

**Prérequis** : [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs) stable, CMake (`brew install cmake` / [cmake.org](https://cmake.org)).

```bash
npm install
npm run tauri dev      # lancer en développement

# build de production (macOS : cible 12.0 minimum, requise par whisper.cpp)
MACOSX_DEPLOYMENT_TARGET=12.0 npm run tauri build
```

**Publier une release** : bumper la version dans `src-tauri/tauri.conf.json`, puis :

```bash
git tag v0.2.0 && git push origin v0.2.0
```

La CI compile automatiquement les packages **Windows** et **macOS** et les attache à la release GitHub.

**Stack** : [Tauri v2](https://tauri.app) (Rust + WebView), TypeScript/Vite, [whisper-rs](https://github.com/tazz4843/whisper-rs) (whisper.cpp, Metal sur macOS), [cpal](https://github.com/RustAudio/cpal) pour le micro, API REST Home Assistant côté Rust.

---

## <img src="https://api.iconify.design/lucide:scale.svg?color=%23f0a24f&width=26" align="top"> Mentions légales

Outil communautaire **non officiel**, à usage strictement non commercial et sans collecte de données — la reconnaissance vocale tourne entièrement en local. **WAKFU®** et l'ensemble des noms, personnages, illustrations et éléments associés — dont le personnage de **Rubilax** — sont la propriété exclusive d'**Ankama** ; ce projet n'est ni affilié à, ni approuvé par Ankama. Tout contenu sera retiré à la demande d'un ayant droit. Wakfu © Ankama — tous droits réservés.

<div align="center"><sub>Développé avec ❤️ par <b>Shivax</b></sub></div>
