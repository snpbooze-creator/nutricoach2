// auth.js — Firebase Auth session management, login, logout, route protection

function requireRole(role) {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = 'index.html';
        return resolve(null);
      }
      try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (!doc.exists) {
          window.location.href = 'index.html';
          return resolve(null);
        }
        const data = doc.data();
        if (data.role !== role) {
          window.location.href = data.role === 'nutritionist'
            ? 'nutritionist.html'
            : 'client.html';
          return resolve(null);
        }
        resolve({ userId: user.uid, name: data.name, email: data.email, role: data.role });
      } catch (err) {
        console.error('requireRole error:', err);
        window.location.href = 'index.html';
        resolve(null);
      }
    });
  });
}

async function login(email, password) {
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const doc = await db.collection('users').doc(cred.user.uid).get();
    if (!doc.exists) return { ok: false, error: 'User profile not found.' };
    const data = doc.data();
    const session = { userId: cred.user.uid, name: data.name, email: data.email, role: data.role };
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: _authError(err.code) };
  }
}

async function createUser({ name, email, password, role }) {
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;

    await db.collection('users').doc(uid).set({ name, email, role });

    if (role === 'client') {
      const clientRef = db.collection('clients').doc();
      await clientRef.set({
        userId: uid,
        nutritionistId: null,
        name,
        age: null,
        height: '',
        goal: '',
        allergies: '',
        notes: '',
        currentWeight: null
      });
    }

    return { ok: true, user: { uid, name, email, role } };
  } catch (err) {
    return { ok: false, error: _authError(err.code) };
  }
}

async function logout() {
  await auth.signOut();
  window.location.href = 'index.html';
}

async function deleteAccount() {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in.' };
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    const role = userDoc.exists ? userDoc.data().role : null;
    const batch = db.batch();

    if (role === 'nutritionist') {
      // Unassign all clients so they don't become orphaned
      const clients = await db.collection('clients').where('nutritionistId', '==', user.uid).get();
      clients.docs.forEach(doc => batch.update(doc.ref, { nutritionistId: null }));
    }

    if (role === 'client') {
      // Delete the clients doc so the account vanishes from the nutritionist's list
      const clientSnap = await db.collection('clients').where('userId', '==', user.uid).limit(1).get();
      if (!clientSnap.empty) {
        const clientId = clientSnap.docs[0].id;
        batch.delete(clientSnap.docs[0].ref);
        // Delete their appointments so they vanish from the nutritionist's appointments tab too
        const appts = await db.collection('appointments').where('clientId', '==', clientId).get();
        appts.docs.forEach(doc => batch.delete(doc.ref));
      }
    }

    batch.delete(db.collection('users').doc(user.uid));
    await batch.commit();
    await user.delete();
    return { ok: true };
  } catch (err) {
    if (err.code === 'auth/requires-recent-login') {
      return { ok: false, requiresReauth: true, error: 'Please re-enter your password to confirm.' };
    }
    return { ok: false, error: err.message };
  }
}

async function reauthAndDelete(password) {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in.' };
  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
    await user.reauthenticateWithCredential(credential);
    return await deleteAccount();
  } catch (err) {
    return { ok: false, error: _authError(err.code) };
  }
}

function _authError(code) {
  switch (code) {
    case 'auth/user-not-found':       return 'No account found with that email.';
    case 'auth/wrong-password':       return 'Incorrect password.';
    case 'auth/invalid-email':        return 'Please enter a valid email address.';
    case 'auth/email-already-in-use': return 'An account with this email already exists.';
    case 'auth/weak-password':        return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':    return 'Too many attempts. Please try again later.';
    case 'auth/invalid-credential':   return 'Invalid email or password.';
    default:                          return 'An error occurred. Please try again.';
  }
}
