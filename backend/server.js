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
// FOLLOW-UPS - People emailed but not in leads (didn't reply)
// =========================================================

app.get('/api/follow-ups', async (req, res) => {
  try {
    // Get all emails from leads table (people who replied)
    const { data: leads } = await supabase.from('leads').select('email');
    const repliedEmails = new Set((leads || []).map(l => l.email?.toLowerCase()).filter(Boolean));
    
    // Get unique contacts from email_log, grouped by email with latest sent date
    const { data: emailLogs } = await supabase
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false });
    
    // Group by email, keep the most recent entry and count total emails
    const emailMap = new Map();
    for (const log of (emailLogs || [])) {
      const email = log.email?.toLowerCase();
      if (!email || repliedEmails.has(email)) continue;
      
      if (!emailMap.has(email)) {
        emailMap.set(email, { ...log, email_count: 1 });
      } else {
        emailMap.get(email).email_count++;
      }
    }
    
    const unreplied = Array.from(emailMap.values());
    res.json(unreplied);
  } catch (err) {
    console.error('Follow-ups error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send follow-up emails to all unreplied contacts
app.post('/api/send-follow-ups', async (req, res) => {
  const { yourName, yourCompany, yourPhone } = req.body;
  
  const config = {
    yourName: yourName || 'Dylan Bennett',
    yourCompany: yourCompany || 'ABC Real Estate',
    yourPhone: yourPhone || '(302) 922-4238'
  };

  try {
    // Get unreplied contacts
    const { data: leads } = await supabase.from('leads').select('email');
    const repliedEmails = new Set((leads || []).map(l => l.email?.toLowerCase()).filter(Boolean));
    
    const { data: emailLogs } = await supabase
      .from('email_log')
      .select('*')
      .order('sent_at', { ascending: false });
    
    const emailMap = new Map();
    for (const log of (emailLogs || [])) {
      const email = log.email?.toLowerCase();
      if (!email || repliedEmails.has(email)) continue;
      if (!emailMap.has(email)) {
        emailMap.set(email, log);
      }
    }
    
    const unreplied = Array.from(emailMap.values());
    let sent = 0, failed = 0;

    for (const contact of unreplied) {
      if (!contact.email) { failed++; continue; }

      const template = EMAIL_TEMPLATES[contact.type] || EMAIL_TEMPLATES.outofstate;
      const firstName = contact.name?.split(' ')[0] || 'there';
      
      // Follow-up subject line
      const followUpSubject = `Following up: ${template.subject}`;
      
      try {
        const { error } = await resend.emails.send({
          from: `${config.yourName} <onboarding@resend.dev>`,
          to: contact.email,
          subject: followUpSubject,
          text: `Hi ${firstName},

I wanted to follow up on my previous message about your property at ${contact.address || 'your property'}.

I understand you're busy, but if your situation has changed or you'd like to explore your options, I'm here to help.

No pressure at all - just let me know if you'd like to chat.

Best regards,
${config.yourName}
${config.yourCompany}
${config.yourPhone}`
        });

        if (error) {
          console.error('Follow-up error:', contact.email, error);
          failed++;
        } else {
          sent++;
          await supabase.from('email_log').insert({
            email: contact.email,
            name: contact.name,
            address: contact.address,
            type: contact.type,
            subject: followUpSubject,
            sent_at: new Date().toISOString(),
            status: 'follow-up'
          });
        }
      } catch (err) {
        console.error('Send error:', contact.email, err);
        failed++;
      }

      await new Promise(r => setTimeout(r, 500)); // Rate limit
    }

    console.log(`Follow-ups: ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed });
  } catch (err) {
    console.error('Follow-up batch error:', err);
    res.status(500).json({ error: err.message });
  }
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
