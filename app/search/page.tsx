import { cookies } from 'next/headers';
import SearchPage from './SearchPage';
import './search.css';
export default async function Page() {
  const lang = (await cookies()).get('lang')?.value === 'th' ? 'th' : 'en';
  return <SearchPage lang={lang} />;
}
