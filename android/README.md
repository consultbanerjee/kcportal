# Android app (any law firm)

A thin native shell around the firm's portal website. Everything on screen comes from the server, so the website and the app are always identical and need no separate updates.

## Build the APK (no software needed on your computer)
1. Upload the whole portal folder to GitHub as usual (the hidden `.github` folder must go too).
2. On GitHub open **Actions → Build Android app → Run workflow**. Type the firm's portal address and the app name, then run.
3. After about 5 minutes open the finished run and download **portal-app-apk**. Unzip it and send `app-debug.apk` to the phone; the phone will ask to allow installing from this source.

## For another firm
Run the workflow again with that firm's address and name. Same code, different app.

## Play Store (later)
Needs a Google Play developer account (paid by the owner) and a signed bundle with the owner's own keystore. Ask Claude to prepare it when ready.

## Website on phones
Open the portal in Chrome on Android and choose **Install app / Add to Home Screen**. No APK needed.
