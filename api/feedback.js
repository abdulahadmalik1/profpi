export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { type, message, email, url, timestamp } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Feedback message is required' });
    }

    // Log the feedback entry to server console.
    // In production, this can be integrated with Slack webhooks, SendGrid email notification, or a database.
    console.log('=== PROFPI FEEDBACK RECEIVED ===');
    console.log(`Timestamp: ${timestamp || new Date().toISOString()}`);
    console.log(`Type:      ${type || 'general'}`);
    console.log(`Email:     ${email || 'Anonymous'}`);
    console.log(`URL:       ${url || 'Unknown'}`);
    console.log(`Message:   ${message}`);
    console.log('=================================');

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Feedback processing failed:', error);
    return res.status(500).json({ error: 'Internal server error while processing feedback' });
  }
}
