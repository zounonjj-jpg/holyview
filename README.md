# HOLYVIEW

Plateforme de streaming chrétien responsive : films, récits bibliques et musique. Frontend Vite, authentification et données sur Supabase, déploiement Vercel, interface installable PWA.

## Fonctionnalités en place

- Interface d’accueil cinématographique, responsive, logo SVG et favicon.
- Manifeste PWA et service worker limité au shell de l’application ; les médias protégés ne sont pas mis en cache par le service worker.
- Inscription/connexion e-mail et mot de passe.
- Inscription avec nom complet, pays, téléphone et validation du plan de numérotation côté navigateur et via Edge Function.
- Catalogue alimenté par les films et pistes publiés dans Supabase ; les cartes de démonstration sont uniquement illustratives.
- Tableau de bord administrateur : statistiques, utilisateurs, pays/téléphones, abonnements, revenus issus des paiements confirmés, catalogue et formulaire de publication.
- Publication de films et musiques dans un bucket Supabase privé, avec droits d’accès Storage limités aux administrateurs.
- Lecteur vidéo/audio utilisant une Edge Function pour vérifier la session, les droits de lecture et l’essai gratuit.
- Sessions de lecture et compteur serveur de l’essai gratuit de cinq heures.
- Tables et permissions RLS pour profils, abonnements, paiements, contenus, sessions de lecture et médias privés.

## Configuration et sécurité

Le frontend utilise l’URL du projet Supabase et une clé publishable dans `src/main.js`. Une clé publishable/anon est conçue pour le navigateur. **Ne jamais placer une clé service-role, un mot de passe ou un secret serveur dans le frontend.**

L’Edge Function `holyview-playback` utilise la session utilisateur et la clé serveur fournie par l’environnement Supabase pour signer les URL privées. L’Edge Function vérifie elle-même le jeton d’authentification. Les fonctions sont versionnées dans `supabase/functions/`.

Le tableau de bord n’apparaît qu’aux comptes présents dans `public.admin_users`. Ne jamais attribuer ce rôle automatiquement au premier compte : provisionner explicitement le compte administrateur après son inscription. Les données d’utilisateurs sont réservées aux administrateurs via RLS.

## Limites connues avant la mise en production commerciale

- La création et la gestion des abonnements sont préparées, mais les paiements réels restent désactivés. Le revenu affiché provient uniquement des lignes de paiement au statut `succeeded`.
- La mesure de l’essai utilise des battements de lecture serveur ; ce n’est pas un DRM. Une URL de lecture signée reste utilisable jusqu’à son expiration, et la capture d’écran ne peut pas être empêchée par une simple application web.
- L’accès hors ligne ELITE est seulement représenté par une autorisation par média. Les téléchargements chiffrés et le DRM nécessitent une implémentation mobile dédiée.
- Les fichiers volumineux peuvent nécessiter un téléversement reprenable (TUS) pour une meilleure fiabilité.
- Il faut encore réaliser des essais fonctionnels sur plusieurs navigateurs, configurer les droits/licences réels de chaque média et mettre en place les moyens de paiement avant d’ouvrir les abonnements au public.
- La validation du format téléphonique ne prouve pas la possession du numéro ; une confirmation SMS séparée serait nécessaire si cette garantie est requise.

## Développement

```sh
npm install
npm run dev
npm run build
npm run preview
``

## Liens

- Application : https://holyview.vercel.app
- Dépôt : https://github.com/zounonjj-jpg/holyview


## Identité visuelle — couleurs à conserver dans le cahier des charges

- **Fond principal / nuit :** `#09090D`
- **Panneaux :** `#13141A` et `#1A1B23`
- **Texte principal :** `#F8F7FB`
- **Texte secondaire :** `#A5A4B0`
- **Or / champagne / lumière du nom JÉSUS :** tons `#FFF4C6`, `#D5AC5D`, `#BD8D3D`
- **Rose accent :** `#F45B9B`
- **Vert accent / actions :** `#B8EF79`
- **Lignes et séparateurs :** `#2B2C35`

Le nom **JÉSUS** est traité comme une animation typographique élégante (lettres dorées, reflet métallique, apparition séquencée et halo subtil), sans illustration ni personnage représentant Jésus. Les couleurs officielles ci-dessus doivent rester cohérentes dans l’accueil, le catalogue, les Shorts, l’administration, la PWA et les documents du cahier des charges.
