require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const app = express();

app.use(cors({
  origin: FRONTEND_URL === '*' ? '*' : [FRONTEND_URL, 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const resend = new Resend(RESEND_API_KEY);

// Email Templates
const EMAIL_TEMPLATES = {
  divorce: {
    subject: 'We Can Help During This Transition',
    body: (firstName, address, yourName, yourCompany, yourPhone) => `Hi ${firstName},

I understand you may be going through some changes right now. If you're considering selling your property at ${address}, I'd love to help make that process as smooth and stress-free as possible.

We specialize in quick, fair offers with flexible closing dates that work with your timeline.

Would you be open to a brief conversation this week?

Best regards,
${yourName}
${yourCompany}
${yourPhone}`
  },
  probate: {
    subject: 'Assistance with Your Inherited Property',
    body: (firstName, address, yourName, yourCompany, yourPhone) => `Hi ${firstName},

I wanted to reach out regarding the property at ${address}. I specialize in helping families navigate the sale of inherited properties during the probate process.

We can handle all the details and provide a fair cash offer with a timeline that works for you.

If you'd like to discuss options, I'm here to help.

Best regards,
${yourName}
${yourCompany}
${yourPhone}`
  },
  foreclosure: {
    subject: 'Options Available for Your Property',
    body: (firstName, address, yourName, yourCompany, yourPhone) => `Hi ${firstName},

I noticed there may be some financial challenges with your property at ${address}. I want you to know there are options available that could help.

We work with homeowners to find solutions - whether that's a quick sale to avoid foreclosure or other creative arrangements.

Would you be open to a no-pressure conversation about your options?

Best regards,
${yourName}
${yourCompany}
${yourPhone}`
  },
  taxlien: {
    subject: 'Help with Your Property Situation',
    body: (firstName, address, yourName, yourCompany, yourPhone) => `Hi ${firstName},

I wanted to reach out about your property at ${address}. If you're dealing with tax challenges, we may be able to help with a quick, fair solution.

We've helped many homeowners in similar situations resolve their property issues.

Would you be open to discussing your options?

Best regards,
${yourName}
${yourCompany}
${yourPhone}`
  },
  outofstate: {
    subject: 'Interested in Your Out-of-State Property',
    body: (firstName, address, yourName, yourCompany, yourPhone) => `Hi ${firstName},

I noticed you own property at ${address} but live out of state. Managing rental properties from afar can be challenging.

If you're interested in selling, we specialize in making the process easy for remote owners - handling everything for you.

Would you be interested in discussing a potential sale?

Best regards,
${yourName}
${yourCompany}
${yourPhone}`
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =========================================================
// LEADS DATABASE - Only people who replied (added via Chrome extension)
// =========================================================

app.get('/api/contacts', async (req, res) => {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/contacts/:id', async (req, res) => {
  const { data, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Contact not found' });
  res.json(data);
});

app.post('/api/contacts', async (req, res) => {
  const { data, error } = await supabase.from('leads').insert({ ...req.body, created_at: new Date().toISOString() }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

app.put('/api/contacts/:id', async (req, res) => {
  const { data, error } = await supabase.from('leads').update(req.body).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/contacts/:id', async (req, res) => {
  const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// =========================================================
// SEND BULK EMAILS - Does NOT save to database
// =========================================================

app.post('/api/send-bulk-emails', async (req, res) => {
  const { leads, yourName, yourCompany, yourPhone } = req.body;
  
  if (!leads || leads.length === 0) {
    return res.status(400).json({ error: 'No leads provided' });
  }

  const config = {
    yourName: yourName || 'Dylan Bennett',
    yourCompany: yourCompany || 'ABC Real Estate',
    yourPhone: yourPhone || '(302) 922-4238'
  };

  let sent = 0, failed = 0;

  for (const lead of leads) {
    if (!lead.email) { failed++; continue; }

    const template = EMAIL_TEMPLATES[lead.type] || EMAIL_TEMPLATES.outofstate;
    const firstName = lead.firstName || lead.name?.split(' ')[0] || 'there';
    
    try {
      const { error } = await resend.emails.send({
        from: `${config.yourName} <onboarding@resend.dev>`,
        to: lead.email,
        subject: template.subject,
        text: template.body(firstName, lead.address || 'your property', config.yourName, config.yourCompany, config.yourPhone)
      });

      if (error) {
        console.error('Email error:', lead.email, error);
        failed++;
      } else {
        sent++;
        // Log email (but NOT to leads table)
        await supabase.from('email_log').insert({
          email: lead.email,
          name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.name,
          address: lead.address,
          type: lead.type,
          subject: template.subject,
          sent_at: new Date().toISOString(),
          status: 'sent'
        });
      }
    } catch (err) {
      console.error('Send error:', lead.email, err);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }

  console.log(`Bulk emails: ${sent} sent, ${failed} failed`);
  res.json({ success: true, sent, failed });
});

// =========================================================
// EMAIL STATS
// =========================================================

app.get('/api/email-stats', async (req, res) => {
  const { count } = await supabase.from('email_log').select('*', { count: 'exact', head: true });
  res.json({ totalSent: count || 0 });
});

app.get('/api/email-logs', async (req, res) => {
  const { data } = await supabase.from('email_log').select('*').order('sent_at', { ascending: false }).limit(100);
  res.json(data || []);
});

// =========================================================
// SEND EMAIL TO EXISTING LEAD (in database)
// =========================================================

app.post('/api/contacts/:id/send-email', async (req, res) => {
  const { yourName, yourCompany, yourPhone } = req.body;
  
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
  if (error || !lead) return res.status(404).json({ error: 'Contact not found' });

  const config = { yourName: yourName || 'Dylan Bennett', yourCompany: yourCompany || 'ABC Real Estate', yourPhone: yourPhone || '(302) 922-4238' };
  const template = EMAIL_TEMPLATES[lead.type] || EMAIL_TEMPLATES.outofstate;
  const firstName = lead.firstName || lead.name?.split(' ')[0] || 'there';

  try {
    const { error: sendError } = await resend.emails.send({
      from: `${config.yourName} <onboarding@resend.dev>`,
      to: lead.email,
      subject: template.subject,
      text: template.body(firstName, lead.address || 'your property', config.yourName, config.yourCompany, config.yourPhone)
    });

    if (sendError) return res.json({ success: false, error: sendError.message });

    await supabase.from('leads').update({ last_contacted_date: new Date().toISOString(), status: 'contacted' }).eq('id', req.params.id);
    await supabase.from('email_log').insert({ email: lead.email, name: lead.name, address: lead.address, type: lead.type, subject: template.subject, sent_at: new Date().toISOString(), status: 'sent' });

    res.json({ success: true, email: lead.email });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`CRM Backend running on port ${PORT}`));
