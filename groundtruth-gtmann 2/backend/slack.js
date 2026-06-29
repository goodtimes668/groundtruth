import axios from 'axios';

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const STATUS_EMOJI = {
  planned: '⏳', in_progress: '🔨', on_track: '✅',
  slipping: '⚠️', blocked: '🚫', done: '🏁'
};

export async function postToSlack(text, blocks = null) {
  if (!WEBHOOK_URL) { console.log('[slack] skip:', text); return; }
  try {
    await axios.post(WEBHOOK_URL, blocks ? { text, blocks } : { text });
  } catch (err) { console.error('[slack]', err.message); }
}

export async function postToUser(slackUserId, text) {
  if (!BOT_TOKEN || !slackUserId) return;
  try {
    await axios.post('https://slack.com/api/chat.postMessage', { channel: slackUserId, text },
      { headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
  } catch (err) { console.error('[slack DM]', err.message); }
}

export async function notifyStatusChange(item, oldStatus, newStatus, by, sub) {
  const emoji = STATUS_EMOJI[newStatus] || '';
  const labels = {
    planned: 'set to planned', in_progress: 'started', on_track: 'confirmed on track',
    slipping: 'flagged slipping', blocked: 'BLOCKED', done: 'marked done'
  };
  const text = `${emoji} *${item.name}* ${labels[newStatus] || newStatus} by ${by}`;
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `📍 ${item.area || '—'}` },
        { type: 'mrkdwn', text: `🔧 ${item.trade}` },
        { type: 'mrkdwn', text: `Status: ${oldStatus} → ${newStatus}` }
      ]
    }
  ];
  if (newStatus === 'blocked' && item.notes) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Blocker:* ${item.notes}` } });
  }
  await postToSlack(text, blocks);

  // If sub is assigned and their item is now slipping or blocked, DM them
  if (sub && sub.slackUserId && (newStatus === 'slipping' || newStatus === 'blocked')) {
    await postToUser(sub.slackUserId, `${emoji} Heads up — *${item.name}* (${item.area || ''}) is ${newStatus}. Foreman notes: ${item.notes || '_(none)_'}`);
  }
}

export async function notifyDailyDrift(driftSummary) {
  if (!driftSummary.slipping.length && !driftSummary.blocked.length) return;
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*📊 GroundTruth daily — ${driftSummary.date}*` } }
  ];
  if (driftSummary.blocked.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🚫 *Blocked (${driftSummary.blocked.length})*\n` + driftSummary.blocked.map(i => `• ${i.name} — ${i.notes || 'no reason'}`).join('\n') }
    });
  }
  if (driftSummary.slipping.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `⚠️ *Slipping (${driftSummary.slipping.length})*\n` + driftSummary.slipping.map(i => `• ${i.name} — ${i.daysShift > 0 ? '+' + i.daysShift + 'd' : i.daysShift + 'd'}`).join('\n') }
    });
  }
  await postToSlack(`📊 Daily drift report`, blocks);
}
