// State variables
let currentOrder = null;
let currentProduct = 'PAKJAZZCASH';
let pollingTimer = null;
let countdownTimer = null;
let countdownSeconds = 60;
let merchantData = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const paramProduct = urlParams.get('payProductCode') || 'PAKJAZZCASH';
  const paramOrderNo = urlParams.get('orderNo');
  const paramAmount = urlParams.get('amount') || '100';

  // Apply initial product theme
  switchProduct(paramProduct, false);

  if (paramOrderNo) {
    await fetchOrderDetails(paramOrderNo);
  } else {
    await createNewOrder(paramAmount, paramProduct);
  }

  setupMobileInput();
});

// Switch between JazzCash and EasyPaisa
function switchProduct(productCode, triggerOrderUpdate = true) {
  currentProduct = productCode;
  const isJC = productCode === 'PAKJAZZCASH';

  const screen = document.getElementById('main-screen');
  const pageTitle = document.getElementById('page-title');
  const headerTitle = document.getElementById('header-title-text');
  const guideTitle = document.getElementById('guide-title-text');
  const btnText = document.getElementById('btn-text');
  const guideLogo = document.getElementById('guide-logo-img');
  const tabJc = document.getElementById('tab-jc');
  const tabEp = document.getElementById('tab-ep');
  const guideDescEn = document.getElementById('guide-desc-en-text');
  const guideDescUr = document.getElementById('guide-desc-ur-text');
  const openAppText = document.getElementById('open-app-text');

  if (isJC) {
    screen.className = 'screen theme-jc';
    pageTitle.textContent = 'JazzCash Payment';
    headerTitle.textContent = 'JazzCash Payment';
    guideTitle.textContent = 'Pay with JazzCash';
    btnText.textContent = 'Pay with JazzCash';
    guideLogo.src = '/images/jazzcash-logo.svg';
    tabJc.className = 'tab-btn active';
    tabEp.className = 'tab-btn';
    guideDescEn.textContent = 'Keep your phone nearby. A payment request or MPIN popup will appear on your phone.';
    guideDescUr.textContent = 'اپنا فون قریب رکھیں، ادائیگی کی درخواست یا MPIN پرامپٹ آپ کے موبائل پر ظاہر ہوگا';
    openAppText.textContent = 'Open JazzCash App';
  } else {
    screen.className = 'screen theme-ep';
    pageTitle.textContent = 'EasyPaisa Payment';
    headerTitle.textContent = 'EasyPaisa Payment';
    guideTitle.textContent = 'Pay with EasyPaisa';
    btnText.textContent = 'Pay with EasyPaisa';
    guideLogo.src = '/images/easypaisa-logo.svg';
    tabJc.className = 'tab-btn';
    tabEp.className = 'tab-btn active';
    guideDescEn.textContent = 'Keep your phone nearby. A payment request will appear in your EasyPaisa app.';
    guideDescUr.textContent = 'اپنا فون قریب رکھیں، ادائیگی کی درخواست EasyPaisa ایپ میں آئے گی';
    openAppText.textContent = 'Open EasyPaisa App';
  }

  updateMerchantDisplay();

  if (triggerOrderUpdate && currentOrder) {
    // update URL parameter without reload
    const url = new URL(window.location);
    url.searchParams.set('payProductCode', productCode);
    window.history.replaceState({}, '', url);
  }
}

// Create new order on backend
async function createNewOrder(amount, productCode) {
  try {
    const res = await fetch('/api/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(amount) || 100,
        payProductCode: productCode
      })
    });
    const result = await res.json();
    if (result.code === '000000') {
      currentOrder = result.data;
      renderOrderInfo(result.data);
      await fetchOrderDetails(result.data.orderNo);
    }
  } catch (err) {
    console.error('Failed to create order:', err);
  }
}

// Fetch order details & merchant configuration
async function fetchOrderDetails(orderNo) {
  try {
    const res = await fetch(`/api/order/info/${orderNo}`);
    const result = await res.json();
    if (result.code === '000000') {
      currentOrder = result.data;
      merchantData = result.data.merchantInfo;
      renderOrderInfo(result.data);
      updateMerchantDisplay();

      // If already processed/success
      if (result.data.status === 'SUCCESS') {
        showSuccessView(result.data);
      }
    }
  } catch (err) {
    console.error('Failed to fetch order:', err);
  }
}

function renderOrderInfo(data) {
  const amt = Math.round(data.payAmount || data.amount || 100);
  document.getElementById('disp-amount').textContent = amt;
  document.getElementById('disp-order-no').textContent = data.orderNo;
  const qrAmt = document.getElementById('qr-disp-amount');
  if (qrAmt) qrAmt.textContent = 'PKR ' + amt;

  if (data.dynamicQrUrl) {
    const qrImg = document.getElementById('dynamic-qr-image');
    if (qrImg) qrImg.src = data.dynamicQrUrl;
  }
}

function updateMerchantDisplay() {
  if (!merchantData) return;
  const qrImg = document.getElementById('dynamic-qr-image');
  const dispAccountNo = document.getElementById('disp-account-no');
  const qrDeeplinkBtn = document.getElementById('qr-deeplink-btn');

  if (merchantData.accountNumber && dispAccountNo) {
    dispAccountNo.textContent = merchantData.accountNumber + (merchantData.title ? ` (${merchantData.title})` : '');
  }

  // Deeplink URL based on active channel
  const isJC = currentProduct === 'PAKJAZZCASH';
  const intentUrl = isJC
    ? 'intent://deeplink#Intent;scheme=jazzcash;package=com.techlogix.mobilinkcustomer;end'
    : 'intent://easypaisa.onelink.me/miniapp#Intent;scheme=https;package=pk.com.telenor.phoenix;end';

  if (qrDeeplinkBtn) {
    qrDeeplinkBtn.href = intentUrl;
    qrDeeplinkBtn.textContent = `📲 Open ${isJC ? 'JazzCash' : 'EasyPaisa'} App to Pay`;
    qrDeeplinkBtn.onclick = (e) => {
      triggerQrScanSession();
    };
  }

  // Start background status polling for Dynamic QR scan right from page load
  if (currentOrder && !pollingTimer) {
    startBackgroundPolling(currentOrder.orderNo);
  }
}

function triggerQrScanSession() {
  if (!currentOrder) return;
  openModal();
  fetch('/api/order/qr-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNo: currentOrder.orderNo })
  }).then(r => r.json()).then(() => {
    startStatusPolling(currentOrder.orderNo);
  }).catch(console.error);
}

function startBackgroundPolling(orderNo) {
  if (pollingTimer) return;
  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/order/status/${orderNo}`);
      const result = await res.json();
      if (result.code === '000000' && result.data) {
        if (result.data.status === 'SUCCESS') {
          clearInterval(pollingTimer);
          if (countdownTimer) clearInterval(countdownTimer);
          closeModal();
          showSuccessView(result.data);
        } else if (result.data.status === 'FAILED' || result.data.status === 'REJECTED') {
          clearInterval(pollingTimer);
          if (countdownTimer) clearInterval(countdownTimer);
          closeModal();
          showFailedView(result.data);
        }
      }
    } catch (e) {}
  }, 2500);
}

// Mobile input validation
function setupMobileInput() {
  const input = document.getElementById('mobile-input');
  const wrap = document.getElementById('mobile-wrap');
  const errorText = document.getElementById('mobile-error');
  const submitBtn = document.getElementById('submit-btn');

  input.addEventListener('input', (e) => {
    // Only allow digits
    let val = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = val;

    const isValid = val.startsWith('03') && val.length === 11;

    if (val.length > 0 && !val.startsWith('03')) {
      wrap.classList.add('invalid');
      errorText.classList.add('show');
      errorText.textContent = 'Number must start with 03 (e.g. 03001234567)';
      submitBtn.disabled = true;
    } else if (val.length === 11 && isValid) {
      wrap.classList.remove('invalid');
      errorText.classList.remove('show');
      submitBtn.disabled = false;
    } else {
      wrap.classList.remove('invalid');
      errorText.classList.remove('show');
      submitBtn.disabled = true;
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !submitBtn.disabled) {
      submitPayment();
    }
  });
}

// Copy Order ID
function copyOrderId() {
  if (!currentOrder) return;
  navigator.clipboard.writeText(currentOrder.orderNo).then(() => {
    alert('Order ID copied: ' + currentOrder.orderNo);
  }).catch(() => {
    const temp = document.createElement('input');
    temp.value = currentOrder.orderNo;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    alert('Order ID copied: ' + currentOrder.orderNo);
  });
}

// Submit payment
async function submitPayment() {
  const mobileInput = document.getElementById('mobile-input');
  const mobile = mobileInput.value.trim();

  if (!mobile.startsWith('03') || mobile.length !== 11) {
    alert('Please enter a valid 11-digit mobile number starting with 03');
    return;
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  openModal();

  try {
    const res = await fetch('/api/order/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNo: currentOrder.orderNo,
        mobile: mobile,
        payProductCode: currentProduct
      })
    });

    const result = await res.json();
    if (result.code === '000000') {
      const data = result.data;
      const openBtn = document.getElementById('intent-open-link');

      // Setup intent link for mobile
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);

      let targetAppUrl = '';
      if (isAndroid && data.appAndroidUrl) {
        targetAppUrl = data.appAndroidUrl;
      } else if (isIos && data.appIosUrl) {
        targetAppUrl = data.appIosUrl;
      } else {
        targetAppUrl = data.webApprovalsUrl || '#';
      }

      openBtn.href = targetAppUrl;

      // Auto trigger intent on Android device
      if (isAndroid && targetAppUrl.startsWith('intent://')) {
        setTimeout(() => {
          window.location.href = targetAppUrl;
        }, 500);
      }

      // Start Polling for status approval
      startStatusPolling(currentOrder.orderNo);
    } else {
      alert('Error: ' + (result.message || 'Payment initiation failed'));
      closeModal();
      submitBtn.disabled = false;
    }
  } catch (err) {
    console.error('Submit error:', err);
    alert('Network error. Please try again.');
    closeModal();
    submitBtn.disabled = false;
  }
}

// Background status polling
function startStatusPolling(orderNo) {
  if (pollingTimer) clearInterval(pollingTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  countdownSeconds = 90;
  updateCountdownBadge();

  countdownTimer = setInterval(() => {
    countdownSeconds--;
    updateCountdownBadge();
    if (countdownSeconds <= 0) {
      clearInterval(countdownTimer);
      clearInterval(pollingTimer);
      document.getElementById('modal-status-text').textContent =
        'Timeout waiting for approval. If you already approved, please click "I Have Approved" or check with support.';
    }
  }, 1000);

  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/order/status/${orderNo}`);
      const result = await res.json();
      if (result.code === '000000' && result.data) {
        const status = result.data.status;
        if (status === 'SUCCESS') {
          clearInterval(pollingTimer);
          if (countdownTimer) clearInterval(countdownTimer);
          closeModal();
          showSuccessView(result.data);
        } else if (status === 'REJECTED' || status === 'FAILED') {
          clearInterval(pollingTimer);
          if (countdownTimer) clearInterval(countdownTimer);
          closeModal();
          showFailedView(result.data);
        }
      }
    } catch (e) {
      console.warn('Polling check error:', e);
    }
  }, 2500);
}

// Submit Customer TID proof for manual/webhook verification
async function submitCustomerTid() {
  if (!currentOrder) return;
  const tidInput = document.getElementById('modal-tid-input');
  const msgBox = document.getElementById('tid-msg-box');
  const btn = document.getElementById('modal-tid-submit-btn');

  const trxId = tidInput.value.trim();
  if (!trxId || trxId.length < 5) {
    msgBox.style.display = 'block';
    msgBox.style.color = '#dc2626';
    msgBox.textContent = 'Please enter a valid Transaction ID (e.g. 10 digits from your receipt)';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';
  msgBox.style.display = 'block';
  msgBox.style.color = '#2563eb';
  msgBox.textContent = 'Submitting TID for verification...';

  try {
    const res = await fetch('/api/order/submit-tid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNo: currentOrder.orderNo,
        trxId: trxId
      })
    });

    const result = await res.json();
    if (result.code === '000000') {
      msgBox.style.color = '#16a34a';
      msgBox.textContent = '✓ TID submitted! Checking payment with merchant account...';
      const label = document.getElementById('countdown-label');
      if (label) {
        label.textContent = 'TID Submitted - Awaiting Merchant Approval';
      }
      startStatusPolling(currentOrder.orderNo);
    } else {
      msgBox.style.color = '#dc2626';
      msgBox.textContent = result.message || 'Error verifying TID';
      btn.disabled = false;
      btn.textContent = 'Verify TID';
    }
  } catch (err) {
    msgBox.style.color = '#dc2626';
    msgBox.textContent = 'Network error while verifying TID.';
    btn.disabled = false;
    btn.textContent = 'Verify TID';
  }
}

function openModal() {
  document.getElementById('process-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('process-modal').classList.remove('active');
}

function showSuccessView(orderData) {
  document.getElementById('payment-content-section').style.display = 'none';
  const successCard = document.getElementById('success-screen');
  successCard.classList.add('show');
  document.getElementById('success-amount').textContent = 'PKR ' + (orderData.amount || currentOrder.payAmount);
  document.getElementById('success-order-no').textContent = orderData.orderNo || currentOrder.orderNo;
  document.getElementById('success-mobile').textContent = orderData.mobile || document.getElementById('mobile-input').value || 'Wallet Scan';
}

function showFailedView(orderData) {
  document.getElementById('payment-content-section').style.display = 'none';
  const failCard = document.getElementById('failed-screen');
  failCard.classList.add('show');
  const reasonText = document.getElementById('failed-reason-text');
  if (reasonText && orderData.responseMessage) {
    reasonText.textContent = orderData.responseMessage;
  }
}
