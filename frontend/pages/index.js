import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) router.push('/dashboard');
    else router.push('/login');
  }, []);

  return (
    <>
      <Head>
        <title>GotoDM – Instagram DM Automation</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Redirecting…</p>
      </div>
    </>
  );
}
