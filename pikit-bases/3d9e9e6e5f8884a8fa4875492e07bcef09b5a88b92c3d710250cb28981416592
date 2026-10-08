/**
 * github-app's section of the Settings dialog, GitHub: connecting the project's repository in two
 * clicks, as a GitHub App of the operator's own (GitHub's App Manifest flow).
 *
 * - **Connect GitHub** asks github-app for the manifest (`POST /admin/api/github-app/start`), then
 *   posts it to GitHub in a form (the dashboard's CSP lets a form go to github.com). GitHub creates the
 *   App and sends the browser back to the app, which sends it on to installing the App; after the
 *   install the dashboard opens here again (`/admin/?settings=github-app`).
 * - **What is connected** (`GET /admin/api/github-app/status`): the App, its installation and the
 *   repositories it reaches, the repository (chosen here when there are several), the last token
 *   minted. Check again reads them from GitHub now (`?check=1`).
 * - **Disconnect** forgets the App here (`DELETE /admin/api/github-app`), and links to deleting it on
 *   GitHub.
 *
 * The JSON is github-app's `GitHubAppStatus` (`src/pikit/github-app/api.ts`).
 */

import { Github, OpenNewWindow, Refresh } from "iconoir-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/bui/Button";
import { type PillTone, StatePill } from "@/components/bui/FilterTable";
import { ErrorNote } from "@/components/pikit/error-note";
import { SelectControl, SettingsHeading, SettingsRow } from "@/components/pikit/settings";
import { api, post } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { defineSettings } from "@/lib/settings";

/** github-app's `GitHubAppStatus`, `StartResponse` and `DisconnectResponse` (api.ts). */
interface GitHubAppStatus {
  connected: boolean;
  app?: { id: number; slug: string; name: string; owner: string; url: string; settingsUrl: string; installUrl: string };
  installation?: { id: number; account: string; repositories: string[]; url: string };
  repository?: string;
  lastToken?: { at: number; ok: boolean; error?: string };
  problem?: string;
}
interface StartResponse {
  action: string;
  manifest: string;
}
interface DisconnectResponse {
  disconnected: true;
  settingsUrl?: string;
}

const linkClass = "inline-flex items-center gap-0.5 underline decoration-line-strong underline-offset-2 hover:text-ink";

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={linkClass} href={href} target="_blank" rel="noreferrer">
      {children}
      <OpenNewWindow width={11} height={11} strokeWidth={2} />
    </a>
  );
}

const toError = (thrown: unknown) => (thrown instanceof Error ? thrown : new Error(String(thrown)));

/** Posts `manifest` to GitHub as its form does: the browser leaves for GitHub. */
function submitToGitHub({ action, manifest }: StartResponse) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = manifest;
  form.append(field);
  document.body.append(form);
  form.submit();
}

function GitHubSettings() {
  const [status, setStatus] = useState<GitHubAppStatus>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [organization, setOrganization] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleteAt, setDeleteAt] = useState<string>();

  const load = useCallback((check = false) => {
    setBusy(true);
    api<GitHubAppStatus>(`/github-app/status${check ? "?check=1" : ""}`)
      .then((read) => (setStatus(read), setError(undefined)))
      .catch((thrown: unknown) => setError(toError(thrown)))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => load(), [load]);

  const act = (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    work()
      .catch((thrown: unknown) => setError(toError(thrown)))
      .finally(() => setBusy(false));
  };
  const connect = () =>
    act(async () => {
      const typed = organization.trim();
      submitToGitHub(await post<StartResponse>("/github-app/start", typed === "" ? {} : { organization: typed }));
    });
  const choose = (repository: string) =>
    act(async () => {
      setStatus(await api<GitHubAppStatus>("/github-app/repository", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository }) }));
    });
  const disconnect = () =>
    act(async () => {
      const answer = await api<DisconnectResponse>("/github-app", { method: "DELETE" });
      setConfirming(false);
      setDeleteAt(answer.settingsUrl);
      setStatus({ connected: false });
    });

  if (status === undefined) return error === undefined ? <p className="text-[13px] text-ink-3">Loading</p> : <ErrorNote error={error} title="The GitHub connection cannot be read" />;
  const { app, installation } = status;
  const tone: PillTone = status.connected ? "green" : app === undefined ? "neutral" : "orange";

  return (
    <div>
      <p className="mb-6 text-[13px] leading-relaxed text-ink-2">
        Your agent proposes changes to itself as pull requests on your project's GitHub repository, and you approve them in Proposals. Connect GitHub once: a GitHub App of your own, created
        in your account and installed on the bot's repository. The app then makes its own short-lived tokens for that repository; you paste no token anywhere.
      </p>
      {error !== undefined && (
        <div className="mb-4">
          <ErrorNote error={error} title="GitHub did not answer as expected" />
        </div>
      )}
      {deleteAt !== undefined && (
        <p className="mb-4 rounded-control bg-inset px-3 py-2 text-[13px] text-ink-2">
          Disconnected. The App is still on GitHub: <Link href={deleteAt}>delete it there</Link> (Advanced → Delete GitHub App).
        </p>
      )}
      {status.problem !== undefined && (
        <div className="mb-4">
          <ErrorNote error={new Error(status.problem)} title="Connect GitHub again" />
        </div>
      )}

      <SettingsHeading
        aside={
          app !== undefined && (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => load(true)}>
              <Refresh width={14} height={14} strokeWidth={2} />
              Check again
            </Button>
          )
        }
      >
        GitHub
      </SettingsHeading>
      <SettingsRow label="Status" description={status.connected ? `Tokens are made for ${status.repository}.` : app === undefined ? "Not connected." : installation === undefined ? "Created on GitHub, not installed yet." : "Installed: choose the repository."}>
        <StatePill tone={tone}>{status.connected ? "connected" : app === undefined ? "off" : "not finished"}</StatePill>
      </SettingsRow>

      {app === undefined ? (
        <>
          <SettingsRow
            label="Organization"
            htmlFor="settings-github-organization"
            description="Leave it empty to create the App in your own account. If the bot's repository belongs to an organization, type its name: you need to be one of its owners."
          >
            <input
              id="settings-github-organization"
              aria-label="Organization"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder="your account"
              className="h-8 w-56 rounded-control bg-surface px-2.5 text-[13px] text-ink shadow-btn outline-none placeholder:text-ink-3 focus-visible:shadow-[0_0_0_1px_var(--line-strong),0_0_0_3px_var(--accent-tint)]"
            />
          </SettingsRow>
          <SettingsRow label="Connect" description="Opens GitHub: click Create GitHub App, then install it on the bot's repository only (the one the Deploy to Cloudflare button made). You come back here.">
            <Button variant="primary" disabled={busy} onClick={connect}>
              <Github width={15} height={15} strokeWidth={1.8} />
              Connect GitHub
            </Button>
          </SettingsRow>
        </>
      ) : (
        <>
          <SettingsRow label="GitHub App" description={`${app.name}, owned by ${app.owner}.`}>
            <Link href={app.url}>{app.slug}</Link>
          </SettingsRow>
          <SettingsRow
            label="Installation"
            description={
              installation === undefined
                ? "Install the App on the bot's repository: GitHub sends you back here."
                : installation.repositories.length === 0
                  ? `Installed on ${installation.account}, but on no repository: add the bot's repository to it on GitHub, then Check again.`
                  : `Installed on ${installation.account}: ${installation.repositories.join(", ")}.`
            }
          >
            {installation === undefined ? <Link href={app.installUrl}>Install it</Link> : <Link href={installation.url}>Change repositories</Link>}
          </SettingsRow>
          {installation !== undefined && installation.repositories.length > 1 && (
            <SettingsRow label="Repository" htmlFor="settings-github-repository" description="The project's own: where the agent pushes its branches and opens its pull requests.">
              <SelectControl
                id="settings-github-repository"
                label="Repository"
                value={status.repository ?? ""}
                disabled={busy}
                onChange={(chosen) => chosen !== "" && choose(chosen)}
                options={[...(status.repository === undefined ? [{ value: "", label: "Choose one" }] : []), ...installation.repositories.map((each) => ({ value: each, label: each }))]}
              />
            </SettingsRow>
          )}
          {status.lastToken !== undefined && (
            <SettingsRow label="Last token" description={status.lastToken.ok ? `Made ${formatAgo(status.lastToken.at)}.` : `Failed ${formatAgo(status.lastToken.at)}: ${status.lastToken.error ?? "GitHub refused"}.`}>
              <StatePill tone={status.lastToken.ok ? "green" : "red"}>{status.lastToken.ok ? "ok" : "failing"}</StatePill>
            </SettingsRow>
          )}
          <SettingsRow label="Disconnect" description="Forgets the App here: the agent can no longer push, and proposals can no longer be read. Then delete the App on GitHub.">
            {confirming ? (
              <div className="flex gap-2">
                <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </SettingsRow>
        </>
      )}
    </div>
  );
}

export default defineSettings({
  id: "github-app",
  title: "GitHub",
  icon: Github,
  group: "Agents",
  order: 11,
  requires: ["github"],
  keywords: ["github", "repository", "connect", "app", "token", "self-improvement", "proposals"],
  component: GitHubSettings,
});
