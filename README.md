# L'Essentiel

Une seule page pour tout le quotidien : agenda du jour, repas, tâches ménagères
en rotation, budget de la semaine, eau et sommeil — par personne de la maison.

- Gratuit, sans compte, sans serveur, sans pistage
- Données dans le navigateur (localStorage), export/import JSON
- Fonctionne hors ligne (service worker quand servi par HTTP)
- Installable comme app (manifest PWA) sur téléphone et ordinateur
- Météo locale via open-meteo (API libre, aucune clé)

## Utilisation

Ouvrir `index.html` dans un navigateur. C'est tout.

Pour l'installer comme une vraie app : servir le dossier (par ex. `python3 -m
http.server 8800` puis un tunnel cloudflared), ouvrir l'URL sur le téléphone,
puis « Ajouter à l'écran d'accueil ».

## Fichiers

- index.html   structure
- style.css    thème sombre, sans dégradé, mobile d'abord
- app.js       toute la logique (zéro dépendance)
- manifest.json + sw.js   installation PWA et cache hors ligne
