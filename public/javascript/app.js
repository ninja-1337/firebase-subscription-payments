const prices = {};

// Replace with your Firebase project config.
const firebaseConfig = {
  apiKey: 'AIzaSyAEGmffBNUsVrdVS_iyiI4eUMOWWp4Q5dI',
  authDomain: 'stripe-subs-ext.firebaseapp.com',
  databaseURL: 'https://stripe-subs-ext.firebaseio.com',
  projectId: 'stripe-subs-ext',
  storageBucket: 'stripe-subs-ext.appspot.com',
  messagingSenderId: '955066520266',
  appId: '1:955066520266:web:ec7135a76fea7a1bce9a33',
};

// Replace with your cloud functions location
const functionLocation = 'us-east1';

// Initialize Firebase
const firebaseApp = firebase.initializeApp(firebaseConfig);
const db = firebaseApp.firestore();
const storage = firebaseApp.storage();

let currentUser = null;
let deploymentListenerUnsubscribe = null;
let deployFormInitialized = false;

/**
 * Firebase Authentication configuration
 */
const firebaseUI = new firebaseui.auth.AuthUI(firebase.auth());
const firebaseUiConfig = {
  callbacks: {
    signInSuccessWithAuthResult: function (authResult, redirectUrl) {
      // User successfully signed in.
      // Return type determines whether we continue the redirect automatically
      // or whether we leave that to developer to handle.
      return true;
    },
    uiShown: () => {
      document.querySelector('#loader').style.display = 'none';
    },
  },
  signInFlow: 'popup',
  signInSuccessUrl: '/',
  signInOptions: [
    firebase.auth.GoogleAuthProvider.PROVIDER_ID,
    firebase.auth.EmailAuthProvider.PROVIDER_ID,
  ],
  credentialHelper: firebaseui.auth.CredentialHelper.NONE,
  // Your terms of service url.
  tosUrl: 'https://example.com/terms',
  // Your privacy policy url.
  privacyPolicyUrl: 'https://example.com/privacy',
};
firebase.auth().onAuthStateChanged((firebaseUser) => {
  if (firebaseUser) {
    document.querySelector('#loader').style.display = 'none';
    document.querySelector('main').style.display = 'block';
    currentUser = firebaseUser.uid;
    startDataListeners();
    startDeploymentPipeline();
  } else {
    document.querySelector('main').style.display = 'none';
    firebaseUI.start('#firebaseui-auth-container', firebaseUiConfig);
  }
});

/**
 * Data listeners
 */
function startDataListeners() {
  // Get all our products and render them to the page
  const products = document.querySelector('.products');
  const template = document.querySelector('#product');
  db.collection('products')
    .where('active', '==', true)
    .get()
    .then(function (querySnapshot) {
      querySnapshot.forEach(async function (doc) {
        const priceSnap = await doc.ref
          .collection('prices')
          .where('active', '==', true)
          .orderBy('unit_amount')
          .get();
        if (!'content' in document.createElement('template')) {
          console.error('Your browser doesn’t support HTML template elements.');
          return;
        }

        const product = doc.data();
        const container = template.content.cloneNode(true);

        container.querySelector('h2').innerText = product.name.toUpperCase();
        container.querySelector('.description').innerText =
          product.description?.toUpperCase() || '';
        // Prices dropdown
        priceSnap.docs.forEach((doc) => {
          const priceId = doc.id;
          const priceData = doc.data();
          prices[priceId] = priceData;
          const content = document.createTextNode(
            `${new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: priceData.currency,
            }).format((priceData.unit_amount / 100).toFixed(2))} per ${
              priceData.interval ?? 'once'
            }`
          );
          const option = document.createElement('option');
          option.value = priceId;
          option.appendChild(content);
          container.querySelector('#price').appendChild(option);
        });

        if (product.images.length) {
          const img = container.querySelector('img');
          img.src = product.images[0];
          img.alt = product.name;
        }

        const form = container.querySelector('form');
        form.addEventListener('submit', subscribe);

        products.appendChild(container);
      });
    });
  // Get all subscriptions for the customer
  db.collection('customers')
    .doc(currentUser)
    .collection('subscriptions')
    .where('status', 'in', ['trialing', 'active'])
    .onSnapshot(async (snapshot) => {
      if (snapshot.empty) {
        // Show products
        document.querySelector('#subscribe').style.display = 'block';
        return;
      }
      document.querySelector('#subscribe').style.display = 'none';
      document.querySelector('#my-subscription').style.display = 'block';
      // In this implementation we only expect one Subscription to exist
      const subscription = snapshot.docs[0].data();
      const priceData = (await subscription.price.get()).data();
      document.querySelector(
        '#my-subscription p'
      ).textContent = `You are paying ${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: priceData.currency,
      }).format((priceData.unit_amount / 100).toFixed(2))} per ${
        priceData.interval
      }, giving you the role: ${await getCustomClaimRole()}. 🥳`;
    });
}

/**
 * CICD deployment pipeline
 */
function startDeploymentPipeline() {
  const form = document.querySelector('#deploy-form');
  const versionsList = document.querySelector('#deployment-versions');

  if (!deployFormInitialized) {
    form.addEventListener('submit', handleDeploymentSubmit);
    deployFormInitialized = true;
  }

  if (deploymentListenerUnsubscribe) {
    deploymentListenerUnsubscribe();
  }

  deploymentListenerUnsubscribe = getDeploymentCollection()
    .orderBy('versionNumber', 'desc')
    .onSnapshot((snapshot) => {
      versionsList.innerHTML = '';
      if (snapshot.empty) {
        const emptyState = document.createElement('li');
        emptyState.textContent = 'No releases yet. Upload a ZIP to deploy.';
        emptyState.classList.add('deployment-item');
        versionsList.appendChild(emptyState);
        return;
      }
      snapshot.forEach((doc) => {
        const data = doc.data();
        versionsList.appendChild(renderDeploymentItem(data));
      });
    });
}

function getDeploymentCollection() {
  return db
    .collection('cicdDeployments')
    .doc(currentUser)
    .collection('versions');
}

async function handleDeploymentSubmit(event) {
  event.preventDefault();
  const status = document.querySelector('#deploy-status');
  const fileInput = document.querySelector('#deploy-zip');
  const notesInput = document.querySelector('#deploy-message');

  if (!currentUser) {
    status.textContent = 'Please sign in before deploying.';
    return;
  }

  const file = fileInput.files[0];
  if (!file) {
    status.textContent = 'Select a ZIP file to deploy.';
    return;
  }

  const isZip =
    file.type.includes('zip') || file.name.toLowerCase().endsWith('.zip');
  if (!isZip) {
    status.textContent = 'Only ZIP files are supported for deployments.';
    return;
  }

  status.textContent = 'Uploading ZIP to Firebase Storage...';

  const collection = getDeploymentCollection();
  const versionNumber = await getNextVersionNumber(collection);
  const versionTag = `v${versionNumber}`;
  const storageRef = storage
    .ref()
    .child(`deployments/${currentUser}/${versionTag}/${file.name}`);

  await storageRef.put(file);
  const downloadUrl = await storageRef.getDownloadURL();

  const steps = [
    { name: 'Upload ZIP', status: 'complete' },
    { name: 'Unzip & version in Git', status: 'queued' },
    { name: 'Re-zip & deploy to Firebase', status: 'queued' },
  ];

  await collection.add({
    versionNumber,
    versionTag,
    fileName: file.name,
    fileSize: file.size,
    releaseNotes: notesInput.value.trim(),
    downloadUrl,
    steps,
    status: 'queued',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  status.textContent =
    'Deployment queued. A CI worker can now unzip, version, and deploy.';
  event.target.reset();
}

async function getNextVersionNumber(collection) {
  const snapshot = await collection
    .orderBy('versionNumber', 'desc')
    .limit(1)
    .get();
  if (snapshot.empty) {
    return 1;
  }
  const lastVersion = snapshot.docs[0].data().versionNumber || 0;
  return lastVersion + 1;
}

function renderDeploymentItem(data) {
  const template = document.querySelector('#deployment-item');
  const fragment = template.content.cloneNode(true);
  const title = fragment.querySelector('.deployment-title');
  const meta = fragment.querySelector('.deployment-meta');
  const download = fragment.querySelector('.deployment-download');
  const notes = fragment.querySelector('.deployment-notes');
  const steps = fragment.querySelector('.deployment-steps');

  title.textContent = `${data.versionTag ?? 'Version'} · ${data.status ?? ''}`;
  meta.textContent = [
    data.fileName,
    formatBytes(data.fileSize),
    formatTimestamp(data.createdAt),
  ]
    .filter(Boolean)
    .join(' • ');

  if (data.downloadUrl) {
    download.href = data.downloadUrl;
  } else {
    download.remove();
  }

  notes.textContent = data.releaseNotes || 'No release notes provided.';

  (data.steps || []).forEach((step) => {
    const item = document.createElement('li');
    item.textContent = `${step.name}: ${step.status}`;
    steps.appendChild(item);
  });

  return fragment;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp || !timestamp.toDate) return '';
  return timestamp.toDate().toLocaleString();
}

/**
 * Event listeners
 */

// Signout button
document
  .getElementById('signout')
  .addEventListener('click', () => firebase.auth().signOut());

// Checkout handler
async function subscribe(event) {
  event.preventDefault();
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const formData = new FormData(event.target);
  const selectedPrice = {
    price: formData.get('price'),
  };
  // For prices with metered billing we need to omit the quantity parameter.
  // For all other prices we set quantity to 1.
  if (prices[selectedPrice.price]?.recurring?.usage_type !== 'metered')
    selectedPrice.quantity = 1;
  const checkoutSession = {
    automatic_tax: true,
    tax_id_collection: true,
    collect_shipping_address: true,
    allow_promotion_codes: true,
    line_items: [selectedPrice],
    success_url: window.location.origin,
    cancel_url: window.location.origin,
    metadata: {
      key: 'value',
    },
  };
  // For one time payments set mode to payment.
  if (prices[selectedPrice.price]?.type === 'one_time') {
    checkoutSession.mode = 'payment';
    checkoutSession.payment_method_types = ['card', 'sepa_debit', 'sofort'];
  }

  const docRef = await db
    .collection('customers')
    .doc(currentUser)
    .collection('checkout_sessions')
    .add(checkoutSession);
  // Wait for the CheckoutSession to get attached by the extension
  docRef.onSnapshot((snap) => {
    const { error, url } = snap.data();
    if (error) {
      // Show an error to your customer and then inspect your function logs.
      alert(`An error occured: ${error.message}`);
      document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
    if (url) {
      window.location.assign(url);
    }
  });
}

// Billing portal handler
document
  .querySelector('#billing-portal-button')
  .addEventListener('click', async (event) => {
    document.querySelectorAll('button').forEach((b) => (b.disabled = true));

    // Call billing portal function
    const functionRef = firebase
      .app()
      .functions(functionLocation)
      .httpsCallable('ext-firestore-stripe-subscriptions-createPortalLink');
    const { data } = await functionRef({ returnUrl: window.location.origin });
    window.location.assign(data.url);
  });

// Get custom claim role helper
async function getCustomClaimRole() {
  await firebase.auth().currentUser.getIdToken(true);
  const decodedToken = await firebase.auth().currentUser.getIdTokenResult();
  return decodedToken.claims.stripeRole;
}
