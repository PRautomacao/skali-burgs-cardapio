const DEFAULT_N8N_WEBHOOK_URL = 'https://n8n.skali-burgs.com/webhook/pedido-confirmacao';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paymentLabel(payment) {
  const labels = {
    pix: 'PIX',
    cartao: 'Cartao',
    dinheiro: 'Dinheiro'
  };
  return labels[payment] || payment || 'Nao informado';
}

function buildStoreMessage(order) {
  const lines = [
    "?? *NOVO PEDIDO - SKALI BURG'S*",
    '-----------------------------',
    `Cliente: ${order.cliente}`,
    `Telefone: ${order.telefone}`,
    `Entrega: ${order.entrega === 'delivery' ? 'Delivery' : 'Retirada'}`
  ];

  if (order.endereco) lines.push(`Endereco: ${order.endereco}`);

  lines.push('');
  lines.push('*Itens:*');

  for (const item of order.itens || []) {
    lines.push(`- ${item.qty}x ${item.name} (${formatCurrency(Number(item.price) * Number(item.qty))})`);
  }

  lines.push('');
  if (Number(order.taxa) > 0) lines.push(`Taxa de entrega: ${formatCurrency(order.taxa)}`);
  lines.push(`Total: ${formatCurrency(order.total)}`);
  lines.push(`Pagamento: ${paymentLabel(order.pagamento)}`);

  if (order.troco) {
    const trocoValue = Number(order.troco) - Number(order.total || 0);
    lines.push(`Troco para: ${formatCurrency(order.troco)}${trocoValue >= 0 ? ` | Troco: ${formatCurrency(trocoValue)}` : ''}`);
  }

  if (order.observacoes) lines.push(`Observacoes: ${order.observacoes}`);
  if (order.criado_em) lines.push(`Criado em: ${order.criado_em}`);

  return lines.join('\n');
}

function buildCustomerConfirmation(order) {
  return [
    `Ola, ${order.cliente}!`,
    "Recebemos seu pedido no Skali Burg's com sucesso.",
    `Total: ${formatCurrency(order.total)}`,
    'Agora vamos preparar tudo e seguir com a confirmacao.'
  ].join('\n');
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Webhook-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const order = await readJsonBody(req);
    const phone = normalizePhone(order.telefone);

    if (!order.cliente || !phone || !Array.isArray(order.itens) || order.itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Payload do pedido incompleto' });
    }

    const n8nWebhookUrl = process.env.N8N_ORDER_WEBHOOK_URL || DEFAULT_N8N_WEBHOOK_URL;
    const n8nSecret = process.env.N8N_ORDER_WEBHOOK_SECRET || '';
    const webhookPayload = {
      event: 'pedido_confirmado',
      order,
      messages: {
        loja: buildStoreMessage(order),
        cliente: buildCustomerConfirmation(order)
      }
    };

    const headers = { 'Content-Type': 'application/json' };
    if (n8nSecret) headers['X-Webhook-Secret'] = n8nSecret;

    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(webhookPayload)
    });

    const responseText = await n8nResponse.text();
    let responseData = null;

    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = { raw: responseText };
      }
    }

    if (!n8nResponse.ok) {
      return res.status(502).json({
        success: false,
        error: 'n8n retornou erro ao processar o pedido',
        status: n8nResponse.status,
        details: responseData
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Pedido enviado com sucesso',
      protocol: responseData && responseData.protocol ? responseData.protocol : null
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Falha interna ao processar pedido',
      details: error.message
    });
  }
}
