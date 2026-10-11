const http = require('node:http');

// Fake customer database: only this CPF is treated as registered in the demo.
const customers = new Map([
  ['12345678909', { name: 'Ana Demo', email: 'ana.demo@example.com' }],
]);

function validateCpf(input) {
  const original = String(input ?? '').trim();

  // Regex checks the written format: 11 digits, with or without the usual punctuation.
  // It does not determine whether the CPF check digits are mathematically correct.
  const cpfFormatRegex = /^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/;
  if (!cpfFormatRegex.test(original)) return null;

  // Remove dots and the hyphen so the calculation uses only digits.
  const cpf = original.replace(/\D/g, '');

  // A second regex rejects repeated digits (e.g. 11111111111).
  // Such sequences can pass the check-digit calculation but are not accepted CPFs.
  if (/^(\d)\1{10}$/.test(cpf)) return null;

  // Name the first nine digits exactly as in the CNN Brasil formula.
  const [d1, d2, d3, d4, d5, d6, d7, d8, d9] = [...cpf].map(Number);

  // Calculate L with weights from 10 down to 2 to obtain the tenth digit.
  const L = 10 * d1 + 9 * d2 + 8 * d3 + 7 * d4 + 6 * d5 + 5 * d6 + 4 * d7 + 3 * d8 + 2 * d9;
  // The remainder is L modulo 11; remainders 0 and 1 both produce digit 0.
  const restoL = L % 11;
  const d10 = restoL <= 1 ? 0 : 11 - restoL;
  // Compare the calculated digit with digit 10 supplied by the customer.
  if (d10 !== Number(cpf[9])) return null;

  // Calculate M using digits 2 through 10, as written in the article.
  const M = 10 * d2 + 9 * d3 + 8 * d4 + 7 * d5 + 6 * d6 + 5 * d7 + 4 * d8 + 3 * d9 + 2 * d10;
  // Apply the same 0/1 edge case to keep the eleventh digit within 0–9.
  const restoM = M % 11;
  const d11 = restoM <= 1 ? 0 : 11 - restoM;
  if (d11 !== Number(cpf[10])) return null;

  // Return the normalized CPF only after its format and both digits pass.
  return cpf;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  // The chatbot sends the CPF to this single mock lookup endpoint.
  if (request.method !== 'POST' || request.url !== '/customers/lookup') {
    sendJson(response, 404, { error: 'Endpoint not found' });
    return;
  }

  let rawBody = '';
  // Collect and parse the JSON body sent by the chatbot.
  request.on('data', (chunk) => {
    rawBody += chunk;
    if (rawBody.length > 1024 * 1024) request.destroy();
  });
  request.on('end', () => {
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendJson(response, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!body || typeof body.cpf !== 'string') {
      sendJson(response, 400, { error: 'The cpf field must be a string' });
      return;
    }

    const cpf = validateCpf(body.cpf);
    // Invalid CPF: ask the user to enter it again in the chatbot.
    if (!cpf) {
      sendJson(response, 200, { cpfValid: 'NO', registered: 'NO' });
      return;
    }

    // A valid CPF can still be missing from the demo's fake customer database.
    const customer = customers.get(cpf);
    sendJson(response, 200, customer
      ? { cpfValid: 'YES', registered: 'YES', name: customer.name, email: customer.email }
      : { cpfValid: 'YES', registered: 'NO' });
  });
});

if (require.main === module) {
  server.listen(process.env.PORT || 3000, () => {
    console.log(`Mock API listening on port ${process.env.PORT || 3000}`);
  });
}

module.exports = { validateCpf, server };
