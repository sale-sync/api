// The email to the applicant after the team review (boards: designer/boards/affiliate/emails, email-approved and
// email-refused). Sent through Amazon SES from noreply@silastech.co, after the decision is saved: a failed email never
// undoes the decision (the dashboard shows it either way), it is logged and reported as `email: 'failed'`.
//
// AFFILIATE_DECISION_EMAILS  on | off (off: nothing is sent, `email: 'off'`)
// AFFILIATE_STAGE            staging | production: the sender name ("(staging)" on staging, the address is shared) and
//                            the app address the button opens
// Addresses on sample.silastech.co (the staging checks' throwaway accounts) have no mailbox: never sent, `email: 'skipped'`,
// so the checks cause no bounces on the shared sending reputation.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { PLANS, RATES, type Market } from '../shared/rules';
import type { Affiliate } from '../shared/seed';

export type EmailOutcome = 'sent' | 'skipped' | 'off' | 'failed';
type Stage = 'staging' | 'production';

const ADDRESS = 'noreply@silastech.co';
const APP: Record<Stage, string> = { staging: 'https://staging-affiliate.silastech.co', production: 'https://affiliate.silastech.co' };
const SENDER: Record<Stage, string> = {
    staging: `Silas Tech Affiliate (staging) <${ADDRESS}>`,
    production: `Silas Tech Affiliate <${ADDRESS}>`,
};
const CDN = 'https://cdn.salesync.biz/apd/thumbs';
const PROGRAMME: Record<Market, { name: string; client: string }> = {
    australia: { name: 'trade business in Australia', client: 'a tradie' },
    thailand: { name: 'real estate in Thailand', client: 'a real estate agency' },
};
const NO_MAILBOX = /@sample\.silastech\.co$/i;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (xs: string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

export type DecisionEmail = { subject: string; text: string; html: string };

/** The approved or refused email for this application (a pure function: tested without SES). */
export function decisionEmail(a: Affiliate, stage: Stage): DecisionEmail {
    const p = PROGRAMME[a.market];
    const app = APP[stage];
    const footer = 'You get this email because you applied to the Silas Tech Affiliate programme with this address.';
    if (a.stage === 'approved') {
        const earn = `When ${p.client} subscribes through your link, you earn ${list(PLANS.map((n) => `${RATES[n] * 100}%`))} of their ${list(PLANS.map(String))} month subscription.`;
        const intro = `Your application for the ${p.name} programme is approved. You can make your links now: one for each channel you share on.`;
        return {
            subject: 'Your Silas Tech Affiliate application is approved',
            text: `Welcome, ${a.first}\n\n${intro}\n\nMake your first link: ${app}/dashboard/links\n\n${earn}\n\n${footer}\nSilas Tech, silastech.co\n`,
            html: layout({
                image: 'handshake',
                heading: `Welcome, ${esc(a.first)}`,
                body: `<p style="${P}">${esc(intro)}</p>`,
                button: ['Make your first link', `${app}/dashboard/links`],
                after: `<p style="${SMALL}">${esc(earn)}</p>`,
                footer,
            }),
        };
    }
    const intro = `Thank you for applying to the ${p.name} programme. The Silas Tech team reviewed your application and could not approve it. They left this note:`;
    const reason = a.refusalReason ?? '';
    const after = 'The note is also on your dashboard. An account can apply once, for one programme.';
    return {
        subject: 'About your Silas Tech Affiliate application',
        text: `Hello, ${a.first}\n\n${intro}\n\n${reason}\n\n${after}\n\nOpen your dashboard: ${app}/dashboard\n\n${footer}\nSilas Tech, silastech.co\n`,
        html: layout({
            image: 'folder',
            heading: `Hello, ${esc(a.first)}`,
            body:
                `<p style="${P}">${esc(intro)}</p>` +
                `<div style="margin:0 0 24px;padding:16px 20px;background:#f4f4f2;border-left:3px solid #9ca3af;border-radius:12px;font-size:16px;line-height:24px;color:#111827">${esc(reason)}</div>` +
                `<p style="${SMALL}">${esc(after)}</p>`,
            button: ['Open your dashboard', `${app}/dashboard`],
            footer,
        }),
    };
}

const FONT = "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const P = 'margin:0 0 24px;font-size:16px;line-height:24px;color:#4b5563';
const SMALL = 'margin:0 0 24px;font-size:14px;line-height:21px;color:#4b5563';

/** One column, 600 px, inline styles and tables only: what every mail app renders (the board's tokens as plain values). */
function layout(o: { image: string; heading: string; body: string; button: [string, string]; after?: string; footer: string }): string {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px"><tr><td style="padding:40px">
<p style="margin:0 0 24px;font-size:18px;font-weight:800;letter-spacing:-0.4px;color:#111827">Silas Tech <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:#e5e7eb;font-size:11px;font-weight:600;letter-spacing:0.5px;color:#4b5563;vertical-align:middle">AFFILIATE</span></p>
<img src="${CDN}/${o.image}.png" width="120" height="120" alt="" style="display:block;margin:0 0 24px;border:0">
<h1 style="margin:0 0 16px;font-size:28px;line-height:34px;font-weight:700;color:#111827">${o.heading}</h1>
${o.body}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="border-radius:10px;background:#030712"><a href="${o.button[1]}" style="display:inline-block;padding:12px 18px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${o.button[0]}</a></td></tr></table>
${o.after ?? ''}
<hr style="margin:8px 0 16px;border:0;border-top:1px solid #e5e7eb">
<p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9ca3af">${esc(o.footer)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af">Silas Tech, silastech.co</p>
</td></tr></table></td></tr></table></body></html>`;
}

let ses: SESv2Client | null = null;
/** Tests replace the client (aws-sdk-client-mock works on the class, this keeps one instance per container). */
const client = () => (ses ??= new SESv2Client({ region: 'ap-southeast-2' }));

/** Sends the decision email when it is on; never throws (the decision is already saved). */
export async function sendDecisionEmail(a: Affiliate): Promise<EmailOutcome> {
    if (process.env.AFFILIATE_DECISION_EMAILS !== 'on') return 'off';
    const stage = process.env.AFFILIATE_STAGE;
    if (stage !== 'staging' && stage !== 'production') {
        console.error('decision email: AFFILIATE_STAGE must be staging or production');
        return 'failed';
    }
    if (NO_MAILBOX.test(a.email)) return 'skipped';
    const m = decisionEmail(a, stage);
    try {
        await client().send(
            new SendEmailCommand({
                FromEmailAddress: SENDER[stage],
                Destination: { ToAddresses: [a.email] },
                Content: {
                    Simple: {
                        Subject: { Data: m.subject, Charset: 'UTF-8' },
                        Body: { Text: { Data: m.text, Charset: 'UTF-8' }, Html: { Data: m.html, Charset: 'UTF-8' } },
                    },
                },
            }),
        );
        return 'sent';
    } catch (e) {
        // the address is personal data: log the user id and the error name only
        console.error('decision email failed', { userId: a.userId, error: e instanceof Error ? e.name : 'unknown' });
        return 'failed';
    }
}
