import { getAnalytics, isSupported } from "firebase/analytics";
import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { trace } from "firebase/performance";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { firebaseConfig } from "./firebaseConfig";

let app: FirebaseApp;

if (getApps().length > 0) {
  app = getApp();
  console.log("database:client cached", {
    origin: "engine",
  });
} else {
  app = initializeApp(firebaseConfig);
  console.log("database:client initialized", {
    origin: "engine",
  });
}

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const analytics = isSupported().then((yes) =>
  yes ? getAnalytics(app) : null,
);
// export const remoteConfig = getRemoteConfig(app);
// export const perf = getPerformance(app);
export const trc = trace;
export const functions = getFunctions(app);

const IS_USING_EMULATORS = false;
if (IS_USING_EMULATORS && process.env.NODE_ENV !== "production") {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
  connectStorageEmulator(storage, "localhost", 9199);
  connectAuthEmulator(auth, "http://localhost:9099");
}
