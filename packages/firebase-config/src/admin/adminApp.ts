import { formatFirebasePrivateKey } from ".";
import admin, { credential } from "firebase-admin";
import { initializeApp } from "firebase-admin/app";

export type FirebaseAdminAppParams = {
  projectId: string;
  clientEmail: string;
  storageBucket?: string;
  privateKey: string;
}


export function createFirebaseAdminApp(params: FirebaseAdminAppParams) {
  const privateKey = formatFirebasePrivateKey(params.privateKey);

  // if already created, return the same instance
  if (admin.apps.length > 0) {
    console.log("[engine]: firebase:admin (cached)");
    return admin.app();
  }

  // create certificate
  const cert = credential.cert({
    projectId: params.projectId,
    clientEmail: params.clientEmail,
    privateKey,
  });

  console.debug("[engine]: firebase:admin (initialized)");
  // initialize admin app
  return initializeApp({
    credential: cert,
    projectId: params.projectId,
    storageBucket: params.storageBucket,
  });
}
