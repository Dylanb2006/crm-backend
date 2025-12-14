// =========================================================
// === CONFIGURATION & SETUP ===============================
// =========================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Load credentials from environment variables
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const app = express();

// Middleware
const corsOptions = {
  origin: FRONTEND_URL === '*' ? '*' : [FRONTEND_URL, 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

// Initialize Resend
const resend = new Resend(RESEND_API_KEY);

// =========================================================
// === EMAIL TEMPLATES =====================================
// =========================================================

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
${yourPhone}

P.S. Just reply to this email - I'll personally get back to you within 24 hours.`
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

// =========================================================
// === UTILITY FUNCTIONS ===================================
// =========================================================

async function logEmail(lead, template, status) {
  const name = lead.firstName && lead.lastName 
    ? `${lead.firstName} ${lead.lastName}` 
    : lead.name || lead.email;
  
  try {
    await supabase.from('email_log').insert({
      email: lead.email,
      name: name,
      address: lead.address || 'N/A',
      type: lead.type || 'N/A',
      subject: template.subject,
      sent_at: new Date().toISOString(),
      status: status
    });
  } catch (err) {
    console.error('Error logging email:', err);
  }
}

async function sendEmail(lead, config) {
  const template = EMAIL_TEMPLATES[lead.type] || EMAIL_TEMPLATES.outofstate;
  const firstName = lead.firstName || lead.name?.split(' ')[0] || 'there';
  
  const body = template.body(
    firstName,
    lead.address || 'your property',
    config.yourName,
    config.yourCompany,
    config.yourPhone
  );

  try {
    // Send email using Resend
    const { data, error } = await resend.emails.send({
      from: `${config.yourName} <onboarding@resend.dev>`, // Use your verified domain later
      to: lead.email,
      subject: template.subject,
      text: body
    });

    if (error) {
      console.error('Resend error:', error);
      await logEmail(lead, template, 'failed');
      return { success: false, email: lead.email, error: error.message };
    }

    console.log('Email sent successfully:', data);
    await logEmail(lead, template, 'sent');
    return { success: true, email: lead.email };
  } catch (error) {
    console.error('Error sending to', lead.email, error);
    await logEmail(lead, template, 'failed');
    return { success: false, email: lead.email, error: error.message };
  }
}

// =========================================================
// === API ROUTES ==========================================
// =========================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CRM Backend running with Resend', timestamp: new Date().toISOString() });
});

// Test email connection
app.get('/api/test-email', async (req, res) => {
  try {
    // Just verify the API key is set
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }
    res.json({ success: true, message: 'Resend API configured' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET all contacts
app.get('/api/contacts', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data || []);
});

// GET single contact
app.get('/api/contacts/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json(data);
});

// POST create new contact
app.post('/api/contacts', async (req, res) => {
  const contactData = {
    ...req.body,
    created_at: new Date().toISOString()
  };
  
  const { data: newLead, error } = await supabase
    .from('leads')
    .insert(contactData)
    .select();

  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: 'Failed to add contact: ' + error.message });
  }
  res.status(201).json(newLead[0]);
});

// PUT update contact
app.put('/api/contacts/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .update(req.body)
    .eq('id', req.params.id)
    .select();

  if (error) {
    console.error('Supabase update error:', error);
    return res.status(500).json({ error: 'Failed to update contact' });
  }
  res.json(data[0]);
});

// DELETE contact
app.delete('/api/contacts/:id', async (req, res) => {
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    console.error('Supabase delete error:', error);
    return res.status(500).json({ error: 'Failed to delete contact' });
  }
  res.json({ success: true });
});

// POST send email to specific contact
app.post('/api/contacts/:id/send-email', async (req, res) => {
  const { yourName, yourCompany, yourPhone } = req.body;
  
  // Get the contact
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !lead) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  const config = {
    yourName: yourName || 'Dylan Bennett',
    yourCompany: yourCompany || 'ABC Real Estate',
    yourPhone: yourPhone || '(302) 922-4238'
  };

  const result = await sendEmail(lead, config);
  
  if (result.success) {
    // Update last_contacted_date
    await supabase
      .from('leads')
      .update({ last_contacted_date: new Date().toISOString() })
      .eq('id', req.params.id);
  }

  res.json(result);
});

// GET email logs
app.get('/api/email-logs', async (req, res) => {
  const { data, error } = await supabase
    .from('email_log')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data || []);
});

// =========================================================
// === AUTOMATED EMAIL SENDER (Cron Job) ===================
// =========================================================

async function runAutomatedEmailSender() {
  const config = {
    yourName: process.env.SENDER_NAME || "Dylan Bennett",
    yourCompany: process.env.SENDER_COMPANY || "ABC Real Estate",
    yourPhone: process.env.SENDER_PHONE || "(302) 922-4238"
  };

  console.log(`\n[AUTOMATION] Running scheduled email job at ${new Date().toLocaleTimeString()}`);
  
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .or(`last_contacted_date.is.null,last_contacted_date.lt.${sevenDaysAgo}`);

  if (error) {
    return console.error('[AUTOMATION ERROR]:', error.message);
  }
  
  if (!leads || leads.length === 0) {
    return console.log('[AUTOMATION] No leads require follow-up.');
  }

  console.log(`[AUTOMATION] Found ${leads.length} leads for follow-up.`);
  
  let sent = 0, failed = 0;
  
  for (const lead of leads) {
    if (!lead.email) continue;
    
    const result = await sendEmail(lead, config);

    if (result.success) {
      sent++;
      await supabase
        .from('leads')
        .update({ last_contacted_date: new Date().toISOString() })
        .eq('id', lead.id);
    } else {
      failed++;
    }
    
    // Wait 1 second between emails
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`[AUTOMATION] Complete. Sent: ${sent}, Failed: ${failed}\n`);
}

// Schedule daily at 7:00 AM Eastern
cron.schedule('0 7 * * *', runAutomatedEmailSender, {
  scheduled: true,
  timezone: "America/New_York"
});

console.log('Automated Email Sender scheduled: daily at 7:00 AM Eastern');

// =========================================================
// === START SERVER ========================================
// =========================================================

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║   CRM Backend running on port ${PORT}            ║`);
  console.log(`║   Using Resend for email delivery             ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);
});
