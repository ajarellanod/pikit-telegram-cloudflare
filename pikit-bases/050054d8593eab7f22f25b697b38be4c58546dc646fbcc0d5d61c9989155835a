/**
 * What github-app's routes answer (`/admin/api/github-app/*`), as JSON. Its Settings section
 * (`src/dashboard/src/settings/github-app/index.tsx`) keeps an identical copy: change both together.
 */

/** `GET /admin/api/github-app/status`: what is connected, as stored (with `?check=1`, checked with GitHub now). */
export interface GitHubAppStatus {
  /** A repository is chosen and the credentials can be read: `github.token` mints tokens for it. */
  connected: boolean;
  /** The GitHub App the operator created, once the manifest was converted. */
  app?: {
    id: number;
    slug: string;
    name: string;
    /** The account that owns it (the operator's, or an organization's). */
    owner: string;
    /** Its page on GitHub. */
    url: string;
    /** Where it is deleted (its settings' Advanced page). */
    settingsUrl: string;
    /** Where it is installed on more repositories, or installed at all. */
    installUrl: string;
  };
  /** Its installation, once the operator installed it. */
  installation?: {
    id: number;
    /** The account it is installed on. */
    account: string;
    /** The repositories it may reach, `owner/name` (the first 100). */
    repositories: string[];
    /** Where the operator changes which repositories it reaches. */
    url: string;
  };
  /** The repository tokens are minted for, `owner/name`: chosen when the installation reaches several. */
  repository?: string;
  /** The last token minted, or the last failure to mint one (never the token). */
  lastToken?: { at: number; ok: boolean; error?: string };
  /** Why it is not usable although set up: the credentials cannot be read (the admin token changed). */
  problem?: string;
}

/** `POST /admin/api/github-app/start`'s body. */
export interface StartRequest {
  /** Create the App in this organization (its login) rather than the operator's own account. */
  organization?: string;
}

/**
 * `POST /admin/api/github-app/start`: the form the dashboard posts to GitHub (`action`, with one field,
 * `manifest`). The answer also sets a cookie binding the connection to this browser.
 */
export interface StartResponse {
  action: string;
  manifest: string;
}

/** `PUT /admin/api/github-app/repository`'s body: one of the installation's repositories. */
export interface ChooseRequest {
  repository: string;
}

/** `DELETE /admin/api/github-app`: forgotten here; the App is still on GitHub until deleted there. */
export interface DisconnectResponse {
  disconnected: true;
  /** Where to delete the App on GitHub, when one was connected. */
  settingsUrl?: string;
}

/**
 * An error: `unauthorized` 401; `invalid_request` 400; `invalid_state` 403 (a connection's state that
 * is unknown, used, expired or another browser's or operator's); `already_connected` 409 (disconnect
 * first); `not_connected` 409; `not_installed` 409; `key_changed` 409 (the credentials were sealed with
 * another admin token: connect again); `github_refused` 502 (GitHub said no, or did not answer).
 */
export interface GitHubAppError {
  error: string;
  message?: string;
}
