import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {

  onModuleInit() {
    console.log('Firebase Admin initialized');
  }
}