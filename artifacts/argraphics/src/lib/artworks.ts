import type { ArtworkLicense, ArtworkMedium, LicenseStatus } from '@workspace/api-client-react';

export const MEDIUM_LABEL: Record<ArtworkMedium, string> = { image: '2D work', model: '3D model' };

export const LICENSE_LABEL: Record<LicenseStatus, string> = {
  requested: 'Waiting on the artist',
  accepted: 'Licensed',
  declined: 'Declined',
  ended: 'Ended',
};

export function formatCents(cents: number) {
  return cents === 0 ? 'Free to host' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What an artist has earned and is still owed, from accepted licences. */
export function earnings(licenses: Pick<ArtworkLicense, 'status' | 'priceCents' | 'paidAt'>[]) {
  const earned = licenses.filter((license) => license.status === 'accepted' || license.status === 'ended');
  const paid = earned.filter((license) => license.paidAt).reduce((sum, license) => sum + license.priceCents, 0);
  const owed = earned.filter((license) => !license.paidAt).reduce((sum, license) => sum + license.priceCents, 0);
  return { paidCents: paid, owedCents: owed, totalCents: paid + owed, count: earned.length };
}
