import Stripe from 'stripe';

// Stripe disabled for POC
// if (!process.env.STRIPE_SECRET_KEY) {
//   throw new Error('STRIPE_SECRET_KEY is not defined');
// }

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    })
  : null as any;

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  priceId: string;
  discount?: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 1000,
    price: 10,
    priceId: process.env.STRIPE_PRICE_STARTER || '',
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 5000,
    price: 45,
    priceId: process.env.STRIPE_PRICE_PRO || '',
    discount: '10% off',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    credits: 20000,
    price: 160,
    priceId: process.env.STRIPE_PRICE_ENTERPRISE || '',
    discount: '20% off',
  },
];
