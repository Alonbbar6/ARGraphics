import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ApiError, claim, codeFromPayload, config, getVisitorId, health, scan, type Claim, type PublicDisplay, type ScanResult } from './src/api';

/**
 * Expo Go companion for testing ARGraphics without Xcode. It exercises the real server,
 * printed QR codes and Meshy models, and places models with Apple's AR Quick Look.
 * It does not run the Swift app's ARKit code (card anchoring, torch, real-size placement).
 */

const C = {
  midnight: '#0B0B14',
  card: '#1B1230',
  indigo: '#2A1B5E',
  violet: '#6D28D9',
  orchid: '#A855F7',
  coral: '#F43F5E',
  spotlight: '#FDE68A',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.68)',
  line: 'rgba(255,255,255,0.14)',
  success: '#22C55E',
};
const SERIF = 'Georgia';
const DEMO_CODES = ['demotbl1', 'demotbl2', 'demowall', 'demobar1'];

type Screen = { name: 'scan' } | { name: 'settings' } | { name: 'visit'; code: string; result: ScanResult; selected: PublicDisplay | null };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'scan' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const resolve = useCallback(async (payload: string) => {
    const code = codeFromPayload(payload);
    if (!code) {
      setError('That isn’t an ARGraphics code. Codes are 6–16 letters and numbers.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await scan(code);
      setScreen({ name: 'visit', code, result, selected: result.display ?? result.displays[0] ?? null });
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404 ? 'This code isn’t active anymore.' : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {screen.name === 'scan' && <ScanScreen busy={busy} error={error} onCode={resolve} onSettings={() => setScreen({ name: 'settings' })} />}
        {screen.name === 'settings' && <SettingsScreen onBack={() => setScreen({ name: 'scan' })} />}
        {screen.name === 'visit' && (
          <VisitScreen
            code={screen.code}
            result={screen.result}
            selected={screen.selected}
            onSelect={(display) => setScreen({ ...screen, selected: display })}
            onBack={() => { setError(''); setScreen({ name: 'scan' }); }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/* ------------------------------------------------------------------ scan */

function ScanScreen({ busy, error, onCode, onSettings }: { busy: boolean; error: string; onCode: (payload: string) => void; onSettings: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const lastScan = useRef({ data: '', at: 0 });

  const onScanned = ({ data }: { data: string }) => {
    // The camera reports the same code many times a second; act once.
    const now = Date.now();
    if (busy || (data === lastScan.current.data && now - lastScan.current.at < 4000)) return;
    lastScan.current = { data, at: now };
    onCode(data);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <BrandMark />
        <Pressable onPress={onSettings} hitSlop={12} accessibilityLabel="Connection settings"><Text style={styles.link}>Settings</Text></Pressable>
      </View>
      <Text style={styles.h1}>Point at the code on your table.</Text>
      <Text style={styles.muted}>Scan a printed ARGraphics QR code, or try a demo code below.</Text>

      <View style={styles.camera}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
        ) : (
          <View style={styles.cameraOff}>
            <Text style={styles.muted}>Camera access lets you scan table codes.</Text>
            <Button title="Turn on camera" onPress={() => void requestPermission()} />
          </View>
        )}
        <View pointerEvents="none" style={styles.reticle} />
        {busy && <View style={styles.cameraBusy}><ActivityIndicator color={C.text} size="large" /></View>}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.eyebrow}>DEMO CODES</Text>
      <View style={styles.chips}>
        {DEMO_CODES.map((code) => (
          <Pressable key={code} style={styles.chip} onPress={() => onCode(code)} disabled={busy}><Text style={styles.chipText}>{code}</Text></Pressable>
        ))}
      </View>

      <Text style={styles.eyebrow}>TYPE A CODE</Text>
      <View style={styles.row}>
        <TextInput value={typed} onChangeText={setTyped} placeholder="e.g. demotbl1" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} style={[styles.input, { flex: 1 }]} onSubmitEditing={() => onCode(typed)} />
        <Button title="Go" onPress={() => onCode(typed)} disabled={busy || !typed.trim()} />
      </View>
    </ScrollView>
  );
}

/* ----------------------------------------------------------------- visit */

function VisitScreen({ code, result, selected, onSelect, onBack }: {
  code: string; result: ScanResult; selected: PublicDisplay | null; onSelect: (display: PublicDisplay) => void; onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Scan another code"><Text style={styles.link}>‹ Scan</Text></Pressable>
        <BrandMark />
      </View>
      <Text style={styles.h1}>{result.venue.name}</Text>
      <Text style={styles.muted}>{result.spot.label} · {result.venue.neighborhood ?? result.venue.kind}</Text>

      {selected ? <DisplayDetail key={selected.id} display={selected} code={code} venue={result.venue.name} /> : (
        <View style={styles.card}><Text style={styles.muted}>Nothing is showing at this spot right now.</Text></View>
      )}

      {result.displays.length > 1 && (
        <>
          <Text style={styles.eyebrow}>ALSO AT {result.venue.name.toUpperCase()}</Text>
          {result.displays.filter((display) => display.id !== selected?.id).map((display) => (
            <Pressable key={display.id} style={styles.listRow} onPress={() => onSelect(display)}>
              <Text style={styles.typeLabel}>{typeLabel(display)}</Text>
              <Text style={styles.listTitle}>{display.title}</Text>
              {display.modelUsdzUrl && <Text style={styles.badge}>3D</Text>}
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function DisplayDetail({ display, code, venue }: { display: PublicDisplay; code: string; venue: string }) {
  const image = display.mediaUrl ?? display.thumbnailUrl;
  return (
    <View style={styles.card}>
      <Text style={styles.typeLabel}>{typeLabel(display)}{display.placement !== 'table' ? ` · ${display.placement}` : ''}</Text>
      <Text style={styles.h2}>{display.title}</Text>
      {!!display.description && <Text style={styles.muted}>{display.description}</Text>}
      {display.price && <Text style={styles.price}>{display.price}</Text>}
      {display.artist && <Text style={styles.muted}>By {display.artist.name}</Text>}
      {display.eventStartsAt && <Text style={styles.muted}>{new Date(display.eventStartsAt).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</Text>}

      {display.modelGlbUrl ? <ModelPreview glbUrl={display.modelGlbUrl} /> : image ? (
        <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
      ) : null}

      {display.modelUsdzUrl && <ArButtons usdzUrl={display.modelUsdzUrl} heightCm={display.modelHeightCm ?? null} />}
      {display.offer && <OfferClaim display={display} code={code} venue={venue} />}
    </View>
  );
}

/** Spinnable 3D preview with Google's model-viewer in a web view (Expo Go has no RealityKit). */
function ModelPreview({ glbUrl }: { glbUrl: string }) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js"></script>
<style>html,body{margin:0;height:100%;background:transparent}model-viewer{width:100%;height:100%;--poster-color:transparent}</style>
</head><body><model-viewer src="${glbUrl.replace(/"/g, '&quot;')}" camera-controls auto-rotate shadow-intensity="1" environment-image="neutral" touch-action="pan-y"></model-viewer></body></html>`;
  return (
    <View style={styles.preview}>
      <WebView originWhitelist={['*']} source={{ html, baseUrl: config.baseUrl }} style={{ backgroundColor: 'transparent' }} scrollEnabled={false} />
    </View>
  );
}

/**
 * Native AR through Apple's AR Quick Look: iOS opens the USDZ in its built-in viewer,
 * which detects a surface and places the model. Quick Look shows the model at its authored
 * size (pinch to resize); the Swift app's real-size placement is not available here.
 */
function ArButtons({ usdzUrl, heightCm }: { usdzUrl: string; heightCm: number | null }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      await WebBrowser.openBrowserAsync(usdzUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN });
    } finally {
      setOpening(false);
    }
  };
  return (
    <View style={{ gap: 8, marginTop: 14 }}>
      <Button title={opening ? 'Opening…' : 'View in AR'} hero onPress={() => void open()} disabled={opening} />
      <Pressable onPress={() => void Linking.openURL(usdzUrl)}><Text style={[styles.link, { textAlign: 'center' }]}>Open in Safari instead</Text></Pressable>
      <Text style={styles.note}>
        Point at a table, wait for the surface, then the model lands. Pinch to resize{heightCm ? `; the venue set it to ${heightCm} cm tall in the full app` : ''}.
      </Text>
    </View>
  );
}

function OfferClaim({ display, code, venue }: { display: PublicDisplay; code: string; venue: string }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'claimed'; claim: Claim } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state.kind !== 'claimed') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.kind]);

  const run = async () => {
    setState({ kind: 'busy' });
    try {
      setState({ kind: 'claimed', claim: await claim(display.id, code) });
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setState({ kind: 'error', message: status === 410 ? 'This offer has ended.' : status === 404 ? 'This offer isn’t available.' : (cause as Error).message });
    }
  };

  if (state.kind === 'claimed') {
    const left = Math.max(0, new Date(state.claim.expiresAt).getTime() - now);
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
    return (
      <View style={styles.claimed}>
        <Text style={styles.eyebrowDark}>SHOW THIS TO YOUR SERVER</Text>
        <Text style={styles.claimCode}>{state.claim.confirmationCode}</Text>
        <Text style={styles.claimText}>{state.claim.offerTitle}</Text>
        <Text style={styles.claimText}>{venue}{state.claim.spotLabel ? ` · ${state.claim.spotLabel}` : ''}</Text>
        <Text style={styles.claimTimer}>{left > 0 ? `Valid for ${minutes}:${seconds}` : 'Expired'}</Text>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 14, gap: 8 }}>
      <View style={styles.offerBox}>
        <Text style={styles.offerTitle}>{display.offer!.title}</Text>
        {!!display.offer!.details && <Text style={styles.muted}>{display.offer!.details}</Text>}
      </View>
      <Button title={state.kind === 'busy' ? 'Claiming…' : 'Claim offer'} hero={!display.modelUsdzUrl} onPress={() => void run()} disabled={state.kind === 'busy'} />
      {state.kind === 'error' && <Text style={styles.error}>{state.message}</Text>}
    </View>
  );
}

/* -------------------------------------------------------------- settings */

function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking');
  const [visitor, setVisitor] = useState('');

  const check = useCallback(async () => {
    setStatus('checking');
    setStatus((await health()) ? 'ok' : 'down');
  }, []);

  useEffect(() => { void check(); void getVisitorId().then(setVisitor); }, [check]);

  const save = () => {
    config.baseUrl = baseUrl.trim().replace(/\/$/, '');
    config.apiKey = apiKey.trim();
    void check();
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.link}>‹ Back</Text></Pressable>
        <BrandMark />
      </View>
      <Text style={styles.h1}>Connection</Text>
      <Text style={[styles.status, { color: status === 'ok' ? C.success : status === 'down' ? C.coral : C.muted }]}>
        {status === 'ok' ? '● Connected to the ARGraphics server' : status === 'down' ? '● Can’t reach the server' : '● Checking…'}
      </Text>
      <Text style={styles.eyebrow}>API ADDRESS</Text>
      <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} style={styles.input} />
      <Text style={styles.eyebrow}>IOS API KEY</Text>
      <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} />
      <Button title="Save and test" onPress={save} />
      <Text style={styles.note}>
        Filled in automatically from the Mac running Expo and from IOS_API_KEY in the project’s .env.
        {'\n'}Anonymous visitor ID: {visitor}
      </Text>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- pieces */

function BrandMark() {
  return (
    <View style={styles.brand}>
      <View style={styles.mark}><View style={styles.markDot} /></View>
      <Text style={styles.brandText}>ARGraphics</Text>
    </View>
  );
}

function Button({ title, onPress, disabled, hero }: { title: string; onPress: () => void; disabled?: boolean; hero?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, hero && styles.hero, (disabled || pressed) && { opacity: disabled ? 0.5 : 0.85 }]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function typeLabel(display: PublicDisplay) {
  return { menu_item: 'ON THE MENU', promo_offer: 'OFFER', art_piece: 'ART', event_teaser: 'COMING UP' }[display.type] ?? 'TONIGHT';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.midnight },
  page: { padding: 20, gap: 10, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.orchid },
  markDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.text },
  brandText: { color: C.text, fontWeight: '700', fontSize: 15 },
  h1: { color: C.text, fontFamily: SERIF, fontSize: 32, lineHeight: 38 },
  h2: { color: C.text, fontFamily: SERIF, fontSize: 26, lineHeight: 32 },
  muted: { color: C.muted, fontSize: 15, lineHeight: 21 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  link: { color: C.orchid, fontSize: 15, fontWeight: '600' },
  eyebrow: { color: C.orchid, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, marginTop: 14 },
  eyebrowDark: { color: C.midnight, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  error: { color: C.coral, fontSize: 14 },
  status: { fontSize: 14, fontWeight: '600' },
  camera: { height: 300, borderRadius: 24, overflow: 'hidden', backgroundColor: C.card, marginTop: 6, borderWidth: 1, borderColor: C.line },
  cameraOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  cameraBusy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,11,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  reticle: { position: 'absolute', top: '22%', left: '22%', right: '22%', bottom: '22%', borderWidth: 3, borderColor: C.orchid, borderRadius: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, paddingHorizontal: 14, paddingVertical: 10 },
  chipText: { color: C.text, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, color: C.text, paddingHorizontal: 14, fontSize: 15 },
  button: { minHeight: 48, borderRadius: 999, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  hero: { backgroundColor: C.coral },
  buttonText: { color: C.text, fontSize: 16, fontWeight: '700' },
  card: { borderRadius: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, padding: 18, gap: 6, marginTop: 10 },
  typeLabel: { color: C.orchid, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  price: { color: C.spotlight, fontSize: 18, fontWeight: '700' },
  preview: { height: 280, borderRadius: 18, overflow: 'hidden', backgroundColor: C.indigo, marginTop: 10 },
  image: { height: 220, borderRadius: 18, marginTop: 10, backgroundColor: C.indigo },
  offerBox: { borderRadius: 16, borderWidth: 1, borderColor: C.spotlight, padding: 14, gap: 4 },
  offerTitle: { color: C.spotlight, fontSize: 17, fontWeight: '700' },
  claimed: { marginTop: 14, borderRadius: 20, backgroundColor: C.spotlight, padding: 20, alignItems: 'center', gap: 4 },
  claimCode: { color: C.midnight, fontSize: 40, fontWeight: '800', letterSpacing: 2 },
  claimText: { color: C.midnight, fontSize: 14, textAlign: 'center' },
  claimTimer: { color: C.midnight, fontSize: 15, fontWeight: '700', marginTop: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, padding: 14 },
  listTitle: { color: C.text, fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { color: C.midnight, backgroundColor: C.spotlight, fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
});
