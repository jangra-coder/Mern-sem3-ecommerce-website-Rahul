// The delivery address form, used at checkout and on the account page.
// The server checks every field again; these rules only give quick feedback.
import { useConfig } from '../context.jsx';

export const emptyAddress = { fullName: '', phone: '', address: '', city: '', state: '', pincode: '' };

export function AddressFields({ value, onChange }) {
  const { states } = useConfig();
  const field = (key) => ({
    name: key,
    value: value[key] || '',
    onChange: (e) => onChange({ ...value, [key]: e.target.value }),
    required: true,
  });
  // Numbers only. Spaces, dashes, "+91" or a leading 0 are tidied away as
  // people type (no maxLength here: it would count the spaces and cut digits off).
  const digits = (key, max) => ({
    ...field(key),
    inputMode: 'numeric',
    onChange: (e) => {
      let d = e.target.value.replace(/\D/g, '');
      if (key === 'phone' && d.length > max && d.startsWith('91')) d = d.slice(2);
      if (key === 'phone' && d.length > max && d.startsWith('0')) d = d.slice(1);
      onChange({ ...value, [key]: d.slice(0, max) });
    },
  });

  return (
    <div className="form-grid">
      <label className="field">
        <span>Full name</span>
        <input {...field('fullName')} minLength={2} maxLength={80} autoComplete="name" />
      </label>
      <label className="field">
        <span>Mobile number</span>
        <input {...digits('phone', 10)} pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" autoComplete="tel-national" placeholder="98765 43210" />
      </label>
      <label className="field span-2">
        <span>Address</span>
        <input {...field('address')} minLength={5} maxLength={200} autoComplete="street-address" placeholder="House no., street, area" />
      </label>
      <label className="field">
        <span>City</span>
        <input {...field('city')} minLength={2} maxLength={60} autoComplete="address-level2" />
      </label>
      <label className="field">
        <span>PIN code</span>
        <input {...digits('pincode', 6)} pattern="[0-9]{6}" title="6-digit PIN code" autoComplete="postal-code" />
      </label>
      <label className="field span-2">
        <span>State</span>
        <select {...field('state')} autoComplete="address-level1">
          <option value="" disabled>Choose your state…</option>
          {states.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}
