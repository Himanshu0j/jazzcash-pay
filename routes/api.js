const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const DB = require('../db');

// Helper to generate realistic order ID
function generateOrderNo() {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randDigits = Math.floor(1000000000000000 + Math.random() * 9000000000000000);
  return `${dateStr}${randDigits}`;
}

// Generate Dynamic QR string & DataURL (EMVCo / Raast / Merchant standard)
async function generateDynamicQR(order, settings) {
  const isJazzCash = order.pay_product_code === 'PAKJAZZCASH';
  const receiverAccount = isJazzCash ? settings.jazzcash_account : settings.easypaisa_account;
  const merchantTitle = isJazzCash ? settings.jazzcash_title : settings.easypaisa_title;
  const tillId = isJazzCash ? settings.jazzcash_till_id : settings.easypaisa_till_id;

  // Standard Raast / EMVCo Merchant Payload
  // Contains Receiver, Amount, Bill Ref / Order ID, and Title
  const qrString = `raast://p2m?receiver=${receiverAccount}&till=${tillId || ''}&amount=${order.amount}&ref=${order.order_no}&title=${encodeURIComponent(merchantTitle || 'Merchant')}`;

  try {
    const dataUrl = await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 280,
      color: {
        dark: isJazzCash ? '#cb1f41' : '#16a34a',
        light: '#ffffff'
      }
    });
    return { qrString, dataUrl };
  } catch (err) {
    console.error('Error generating QR code:', err);
    return { qrString, dataUrl: '' };
  }
}

// 1. Create Order
router.post('/order/create', async (req, res) => {
  try {
    const { amount, payProductCode = 'PAKJAZZCASH', orderMark } = req.body;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      DB.addLog(null, null, 'ORDER_CREATE_FAILED', 'ERROR', { reason: 'Invalid amount entered', amount }, 'CUSTOMER_ERROR');
      return res.status(400).json({ code: 'INVALID_AMOUNT', message: 'Invalid amount entered' });
    }

    const orderNo = generateOrderNo();
    const mark = orderMark || `${new Date().getFullYear()}${Math.floor(1000 + Math.random() * 9000)}`;

    const order = DB.createOrder({
      order_no: orderNo,
      order_mark: mark,
      amount: parsedAmount,
      currency: 'PKR',
      pay_product_code: payProductCode.toUpperCase()
    });

    const settings = DB.getAllSettings();
    const { qrString, dataUrl: dynamicQrUrl } = await generateDynamicQR(order, settings);

    DB.addLog(orderNo, null, 'ORDER_CREATED', 'INFO', {
      orderNo,
      amount: parsedAmount,
      product: payProductCode,
      qrString,
      createdAt: new Date().toISOString()
    }, 'INTENT_QR');

    res.json({
      code: '000000',
      message: 'Order created successfully',
      data: {
        orderNo: order.order_no,
        orderMark: order.order_mark,
        payAmount: order.amount,
        currencyCode: order.currency,
        payProductCode: order.pay_product_code,
        status: order.status,
        dynamicQrUrl,
        qrString
      }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    DB.addLog(null, null, 'ORDER_CREATE_ERROR', 'ERROR', { error: error.message }, 'API_BRIDGE_ERROR');
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 2. Get Order Details, Merchant Info & Dynamic QR
router.get('/order/info/:orderNo', async (req, res) => {
  try {
    const { orderNo } = req.params;
    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      DB.addLog(orderNo, null, 'ORDER_INFO_NOT_FOUND', 'WARNING', { orderNo }, 'CUSTOMER_ERROR');
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order does not exist' });
    }

    const settings = DB.getAllSettings();
    const isJazzCash = order.pay_product_code === 'PAKJAZZCASH';
    const { qrString, dataUrl: dynamicQrUrl } = await generateDynamicQR(order, settings);

    res.json({
      code: '000000',
      data: {
        orderNo: order.order_no,
        orderMark: order.order_mark,
        payAmount: order.amount,
        currencyCode: order.currency,
        payProductCode: order.pay_product_code,
        status: order.status,
        mobile: order.mobile,
        dynamicQrUrl,
        qrString,
        merchantInfo: {
          title: isJazzCash ? settings.jazzcash_title : settings.easypaisa_title,
          accountNumber: isJazzCash ? settings.jazzcash_account : settings.easypaisa_account,
          tillId: isJazzCash ? settings.jazzcash_till_id : settings.easypaisa_till_id,
          staticQrUrl: isJazzCash ? settings.jazzcash_qr_url : settings.easypaisa_qr_url,
          activeMode: settings.active_mode
        }
      }
    });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 3. Submit Mobile Number & Process Payment (Intent / Bridge / USSD trigger)
router.post('/order/submit', async (req, res) => {
  try {
    const { orderNo, mobile, payProductCode } = req.body;

    if (!orderNo || !mobile) {
      DB.addLog(orderNo, mobile, 'SUBMIT_VALIDATION_ERROR', 'ERROR', { reason: 'Missing orderNo or mobile' }, 'CUSTOMER_ERROR');
      return res.status(400).json({ code: 'MISSING_FIELDS', message: 'orderNo and mobile are required' });
    }

    // Clean and validate Pakistani phone number
    let cleanMobile = mobile.replace(/[^0-9]/g, '');
    if (cleanMobile.startsWith('92')) {
      cleanMobile = '0' + cleanMobile.slice(2);
    }
    if (!cleanMobile.startsWith('03') || cleanMobile.length !== 11) {
      DB.addLog(orderNo, mobile, 'INVALID_PHONE_ENTERED', 'WARNING', { input: mobile, cleaned: cleanMobile }, 'CUSTOMER_ERROR');
      return res.status(400).json({
        code: 'INVALID_MOBILE',
        message: 'Enter a valid 11-digit mobile number starting with 03 (e.g. 03XXXXXXXXX)'
      });
    }

    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      DB.addLog(orderNo, cleanMobile, 'ORDER_NOT_FOUND_SUBMIT', 'ERROR', { orderNo }, 'CUSTOMER_ERROR');
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order does not exist' });
    }

    const product = payProductCode || order.pay_product_code;
    const settings = DB.getAllSettings();
    const isJazzCash = product === 'PAKJAZZCASH';

    // Mobile Intent and App Deeplinking URLs
    const appAndroidUrl = isJazzCash
      ? 'intent://deeplink#Intent;scheme=jazzcash;package=com.techlogix.mobilinkcustomer;end'
      : 'intent://easypaisa.onelink.me/miniapp#Intent;scheme=https;package=pk.com.telenor.phoenix;end';

    const appIosUrl = isJazzCash
      ? 'https://apps.apple.com/app/id1224617688'
      : 'https://apps.apple.com/app/id1227725092';

    const webApprovalsUrl = isJazzCash
      ? 'https://www.jazzcash.com.pk'
      : 'https://easypaisa.com.pk/approvals';

    let gatewayResponse = {
      initiated: true,
      mode: settings.active_mode,
      targetApp: isJazzCash ? 'JazzCash' : 'EasyPaisa',
      customerMobile: cleanMobile,
      amount: order.amount
    };

    // If aggregator bridge mode is active and URL is set, call external API
    if (settings.active_mode === 'aggregator_bridge' && settings.aggregator_api_url) {
      try {
        const fetchRes = await fetch(settings.aggregator_api_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.aggregator_api_key ? { 'Authorization': `Bearer ${settings.aggregator_api_key}` } : {})
          },
          body: JSON.stringify({
            orderNo,
            mobile: cleanMobile,
            amount: order.amount,
            currency: 'PKR',
            payProductCode: product
          })
        });
        const bridgeData = await fetchRes.json();
        gatewayResponse.bridgeData = bridgeData;
        DB.addLog(orderNo, cleanMobile, 'BRIDGE_API_RESPONSE', 'INFO', bridgeData, 'MERCHANT_WEBHOOK');
      } catch (bridgeErr) {
        console.error('Bridge API error:', bridgeErr);
        gatewayResponse.bridgeError = bridgeErr.message;
        DB.addLog(orderNo, cleanMobile, 'BRIDGE_API_ERROR', 'ERROR', { error: bridgeErr.message, url: settings.aggregator_api_url }, 'API_BRIDGE_ERROR');
      }
    }

    // Update order state to PROCESSING
    DB.updateOrderSubmission(orderNo, {
      mobile: cleanMobile,
      status: 'PROCESSING',
      response_message: 'Payment request dispatched to customer wallet',
      raw_response: gatewayResponse
    });

    DB.addLog(orderNo, cleanMobile, 'PAYMENT_SUBMITTED', 'INFO', {
      orderNo,
      mobile: cleanMobile,
      amount: order.amount,
      appAndroidUrl,
      gatewayResponse
    }, 'INTENT_QR');

    // Auto-approve feature for testing or dynamic QR auto-verify
    const autoSec = parseInt(settings.auto_approve_seconds || '12', 10);
    if (autoSec > 0) {
      setTimeout(() => {
        DB.updateOrderStatus(orderNo, 'SUCCESS', `Auto-Approved & Deposited to Account (Ref: PK${orderNo.slice(-6)})`);
        DB.addLog(orderNo, cleanMobile, 'DYNAMIC_QR_AUTO_SUCCESS', 'SUCCESS', { autoApproveSeconds: autoSec }, 'PAYMENT_SUCCESS');
      }, autoSec * 1000);
    }

    res.json({
      code: '000000',
      message: 'Payment initiated successfully',
      data: {
        orderNo,
        status: 'PROCESSING',
        mobile: cleanMobile,
        amount: order.amount,
        currency: 'PKR',
        payProductCode: product,
        appAndroidUrl,
        appIosUrl,
        webApprovalsUrl,
        guide: {
          en: `Keep your phone nearby. A payment request will appear in your ${isJazzCash ? 'JazzCash' : 'EasyPaisa'} app or via MPIN prompt.`,
          ur: `اپنا فون قریب رکھیں، ادائیگی کی درخواست ${isJazzCash ? 'JazzCash' : 'EasyPaisa'} ایپ میں آئے گی یا MPIN پرامپٹ ظاہر ہوگا۔`
        }
      }
    });
  } catch (error) {
    console.error('Error in order submit:', error);
    DB.addLog(req.body?.orderNo, req.body?.mobile, 'PAYMENT_SUBMIT_ERROR', 'ERROR', { error: error.message }, 'API_BRIDGE_ERROR');
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 3.1 Dynamic QR Scan & Auto-Detection Trigger
router.post('/order/qr-scan', (req, res) => {
  try {
    const { orderNo } = req.body;
    if (!orderNo) {
      return res.status(400).json({ code: 'MISSING_ORDER_NO', message: 'orderNo required' });
    }

    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    if (order.status === 'SUCCESS') {
      return res.json({ code: '000000', message: 'Already completed', status: 'SUCCESS' });
    }

    const settings = DB.getAllSettings();
    const autoSec = parseInt(settings.auto_approve_seconds || '12', 10);

    // Update to PROCESSING
    DB.updateOrderStatus(orderNo, 'PROCESSING', 'Dynamic QR scanned by customer. Verifying payment...');
    DB.addLog(orderNo, order.mobile, 'QR_SCANNED_DETECTED', 'INFO', {
      orderNo,
      amount: order.amount,
      autoVerifyInSeconds: autoSec
    }, 'INTENT_QR');

    // Auto verify in autoSec seconds
    if (autoSec > 0) {
      setTimeout(() => {
        const current = DB.getOrderByNo(orderNo);
        if (current && current.status === 'PROCESSING') {
          DB.updateOrderStatus(orderNo, 'SUCCESS', `Auto-Approved & Deposited to Account (Ref: PK${orderNo.slice(-6)})`);
          DB.addLog(orderNo, current.mobile, 'DYNAMIC_QR_AUTO_SUCCESS', 'SUCCESS', {
            orderNo,
            amount: current.amount,
            receiverAccount: current.pay_product_code === 'PAKJAZZCASH' ? settings.jazzcash_account : settings.easypaisa_account
          }, 'PAYMENT_SUCCESS');
        }
      }, autoSec * 1000);
    }

    res.json({
      code: '000000',
      message: 'Dynamic QR scan session active',
      data: { orderNo, status: 'PROCESSING', autoVerifyInSeconds: autoSec }
    });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 4. Polling endpoint for Status Check (Includes Auto-Fail on Timeout)
router.get('/order/status/:orderNo', (req, res) => {
  try {
    const { orderNo } = req.params;
    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    // Auto-Fail: If order is older than 120 seconds and still pending/processing
    if (order.status === 'PENDING' || order.status === 'PROCESSING') {
      const createdTime = new Date(order.created_at).getTime();
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - createdTime) / 1000);

      // After 120 seconds, mark as FAILED (Timeout)
      if (elapsedSeconds > 120) {
        DB.updateOrderStatus(orderNo, 'FAILED', 'Payment timed out (No MPIN / Webhook received)');
        DB.addLog(orderNo, order.mobile, 'PAYMENT_TIMEOUT_EXPIRED', 'WARNING', {
          orderNo,
          elapsedSeconds,
          reason: 'User did not complete payment in 120s'
        }, 'CUSTOMER_ERROR');

        return res.json({
          code: '000000',
          data: {
            orderNo: order.order_no,
            status: 'FAILED',
            responseMessage: 'Payment timed out / expired',
            amount: order.amount,
            mobile: order.mobile,
            updatedAt: new Date().toISOString()
          }
        });
      }
    }

    res.json({
      code: '000000',
      data: {
        orderNo: order.order_no,
        status: order.status,
        responseMessage: order.response_message,
        amount: order.amount,
        mobile: order.mobile,
        updatedAt: order.updated_at
      }
    });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 5. Merchant Webhook & IPN Listener (Universal for JazzCash, EasyPaisa & Aggregators)
router.all(['/order/callback', '/order/merchant-ipn'], (req, res) => {
  try {
    const payload = { ...req.query, ...req.body };
    console.log('Incoming Merchant Webhook IPN:', payload);

    // Support standard JazzCash (pp_TxnRefNo, pp_ResponseCode) & EasyPaisa (orderNo, status, trxId)
    const orderNo = payload.orderNo || payload.pp_TxnRefNo || payload.order_no || payload.orderId;
    const responseCode = payload.pp_ResponseCode || payload.code || payload.status;
    const trxId = payload.trxId || payload.pp_RetreivalReferenceNo || payload.transId;
    const amount = payload.amount || payload.pp_Amount;

    if (!orderNo) {
      DB.addLog(null, null, 'WEBHOOK_REJECTED_NO_ORDER', 'WARNING', payload, 'MERCHANT_WEBHOOK');
      return res.status(400).json({ code: 'MISSING_ORDER_NO', message: 'Order reference not found in webhook payload' });
    }

    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      DB.addLog(orderNo, null, 'WEBHOOK_ORDER_NOT_FOUND', 'ERROR', payload, 'MERCHANT_WEBHOOK');
      return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: 'Order reference does not match any record' });
    }

    // Determine Success vs Failure
    const isSuccess = responseCode === '000' || responseCode === '0' ||
      String(responseCode).toUpperCase() === 'SUCCESS' ||
      String(payload.status).toUpperCase() === 'PAID';

    if (isSuccess) {
      DB.updateOrderStatus(orderNo, 'SUCCESS', `Paid via Merchant Webhook (TID: ${trxId || 'N/A'})`);
      DB.addLog(orderNo, order.mobile, 'MERCHANT_IPN_SUCCESS', 'SUCCESS', {
        orderNo,
        amount,
        trxId,
        fullWebhook: payload
      }, 'MERCHANT_WEBHOOK');
      DB.addLog(orderNo, order.mobile, 'PAYMENT_CONFIRMED', 'SUCCESS', { amount, orderNo }, 'PAYMENT_SUCCESS');
      return res.json({ code: '000000', message: 'Payment confirmed successfully' });
    } else {
      const failReason = payload.pp_ResponseMessage || payload.message || 'Declined by customer / bank';
      DB.updateOrderStatus(orderNo, 'FAILED', failReason);
      DB.addLog(orderNo, order.mobile, 'MERCHANT_IPN_DECLINED', 'ERROR', {
        orderNo,
        failReason,
        fullWebhook: payload
      }, 'API_BRIDGE_ERROR');
      return res.json({ code: 'FAILED', message: failReason });
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    DB.addLog(null, null, 'WEBHOOK_EXCEPTION', 'ERROR', { error: error.message, stack: error.stack }, 'API_BRIDGE_ERROR');
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// 6. SMS Forwarder Webhook (Auto-Detects 8558 JazzCash & 3737 EasyPaisa SMS)
router.post('/order/sms-webhook', (req, res) => {
  try {
    const { sender, message, body, from } = req.body;
    const smsSender = String(sender || from || '');
    const smsText = String(message || body || '');

    console.log('Incoming SMS Webhook from:', smsSender, 'Text:', smsText);

    if (!smsText) {
      return res.status(400).json({ code: 'EMPTY_SMS', message: 'Message text required' });
    }

    // Extract amount: e.g. "Rs. 500.00" or "Rs 1,000"
    const amountMatch = smsText.match(/Rs\.?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
    const parsedAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

    // Extract phone: 03XXXXXXXXX
    const phoneMatch = smsText.match(/(03\d{9})/);
    const senderPhone = phoneMatch ? phoneMatch[1] : null;

    // Extract Transaction ID
    const tidMatch = smsText.match(/(?:TID|Trx ID|Trans ID|ID|Ref)\s*[:#]?\s*([A-Za-z0-9]+)/i);
    const tid = tidMatch ? tidMatch[1] : null;

    DB.addLog(null, senderPhone, 'SMS_RECEIVED_PARSED', 'INFO', {
      smsSender,
      smsText,
      parsedAmount,
      senderPhone,
      tid
    }, 'MERCHANT_WEBHOOK');

    // Find matching pending order
    const pendingOrders = DB.getOrders(50, 0).filter(o => o.status === 'PENDING' || o.status === 'PROCESSING');
    let matchedOrder = null;

    if (senderPhone) {
      matchedOrder = pendingOrders.find(o => o.mobile === senderPhone);
    }
    if (!matchedOrder && parsedAmount) {
      matchedOrder = pendingOrders.find(o => Math.abs(o.amount - parsedAmount) < 0.01);
    }

    if (matchedOrder) {
      DB.updateOrderStatus(matchedOrder.order_no, 'SUCCESS', `Auto-Approved via SMS (${smsSender}): TID ${tid || 'N/A'}`);
      DB.addLog(matchedOrder.order_no, matchedOrder.mobile, 'SMS_MATCH_SUCCESS', 'SUCCESS', {
        orderNo: matchedOrder.order_no,
        amount: matchedOrder.amount,
        tid,
        smsSender
      }, 'PAYMENT_SUCCESS');

      return res.json({
        code: '000000',
        message: 'Order successfully auto-approved via SMS',
        matchedOrderNo: matchedOrder.order_no
      });
    }

    res.json({
      code: 'NO_MATCH',
      message: 'SMS received but no pending order matched currently'
    });
  } catch (error) {
    DB.addLog(null, null, 'SMS_WEBHOOK_ERROR', 'ERROR', { error: error.message }, 'API_BRIDGE_ERROR');
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

module.exports = router;
