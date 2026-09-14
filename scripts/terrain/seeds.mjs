/*
 * The candidate pool.
 *
 * Half of these are seeds with a public reputation, half are arbitrary. That
 * split is deliberate and the result is worth reading before trusting any
 * seed list you find online: a documented seed is documented FOR A VERSION.
 * World generation changed substantially in 1.18 (height range, noise router)
 * and has kept moving since, so "the famous mountain seed" from a 1.16 video
 * generates something else entirely in 1.21.8. Reputation does not transfer.
 * Scoring does, which is why every candidate below gets measured rather than
 * assumed.
 */
export const CANDIDATE_SEEDS = [
  0,                      // canonical; the seed everyone checks first
  1,                      // canonical
  12345,                  // arbitrary, small
  3257840388504953787n,   // widely circulated "jungle temple" seed
  1669320484,             // widely circulated bamboo/jungle seed
  -4172144997902289642n,  // widely circulated woodland-mansion seed
  2151901553968352745n,   // widely circulated village-cluster seed
  987654321,              // arbitrary
  8675309,                // arbitrary
  4400,                   // arbitrary
]
