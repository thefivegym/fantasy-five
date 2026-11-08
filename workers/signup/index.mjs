// Cloudflare Worker. Holds SIGNUP_GITHUB_TOKEN only in the Worker secret, never in the site.
// Pages posts {instagram}. This commits a new handle-only player file. It does not deploy itself.
import { REPO } from '../../scripts/lib/config.mjs';
import { handleSignup } from '../../scripts/lib/signup-http.mjs';
import { kvRateStore } from '../../scripts/lib/signup-rate.mjs';
import { commitNewPlayer, fetchPlayerSummaries } from '../../scripts/lib/github-player-commit.mjs';

export function createFetch({ token, kv, repo = REPO, fetchImpl = fetch, now } = {}) {
  const rate = kvRateStore(kv);
  return function signupFetch(request) {
    return handleSignup(request, {
      now,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      tokenConfigured: !!(token && rate),
      rate,
      listPlayers: () => fetchPlayerSummaries({ token, repo, fetch: fetchImpl }),
      commit: record => commitNewPlayer({ token, repo, record, fetch: fetchImpl }),
    });
  };
}

export default {
  fetch(request, env) {
    return createFetch({
      token: env.SIGNUP_GITHUB_TOKEN,
      kv: env.SIGNUP_KV,
      repo: env.GITHUB_REPOSITORY || REPO,
    })(request);
  },
};
