import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase Web SDK identifiers are public app configuration, not server secrets.
const config = {
  apiKey: "AIzaSyAs5r0BrsAIDjTP1K_1GF2NEDDMeZs453w",
  authDomain: "kapanigpt.firebaseapp.com",
  projectId: "kapanigpt",
  storageBucket: "kapanigpt.firebasestorage.app",
  messagingSenderId: "474608319698",
  appId: "1:474608319698:web:cdcb12b8d4e9277182c10b",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(firebaseApp);
export const database = getFirestore(firebaseApp);
