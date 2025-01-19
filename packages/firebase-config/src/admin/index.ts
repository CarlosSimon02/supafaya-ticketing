import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createFirebaseAdminApp, FirebaseAdminAppParams } from "./adminApp";

export function formatFirebasePrivateKey(key: string) {
  return key.replace(/\\n/g, "\n");
}

export const params = {
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
} as FirebaseAdminAppParams;

export function initializeAdmin() {
  return createFirebaseAdminApp(params);
}

export const adminFirestore = getFirestore(initializeAdmin());
export const adminAuth = getAuth(initializeAdmin());
