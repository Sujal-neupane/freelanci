import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../hooks/useAuth';

export const MFASetup: React.FC = () => {
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(true);
  const navigate = useNavigate();
  const { updateUser } = useAuth();

  useEffect(() => {
    const fetchMfaSetup = async () => {
      try {
        const response = await apiClient.post('/auth/mfa/setup');
        setQrCodeUrl(response.data.qrCodeUrl);
        setManualEntryKey(response.data.manualEntryKey);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to initialize MFA setup');
      } finally {
        setSetupLoading(false);
      }
    };

    fetchMfaSetup();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiClient.post('/auth/mfa/verify-setup', { token });
      updateUser({ mfaEnabled: true });
      navigate('/dashboard', { state: { message: 'MFA enabled successfully!' } });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF9] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-gray-900">
            Set up Two-Factor Auth
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Secure your account with Google Authenticator
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        {setupLoading ? (
          <div className="text-center py-8 text-gray-500">Loading setup...</div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-xl flex flex-col items-center">
              <p className="text-sm font-medium text-gray-700 mb-4 text-center">
                1. Scan this QR code with your authenticator app
              </p>
              {qrCodeUrl && <img src={qrCodeUrl} alt="MFA QR Code" className="w-48 h-48 bg-white p-2 rounded-lg border border-gray-200" />}
              
              <div className="mt-4 w-full">
                <p className="text-xs text-gray-500 text-center mb-1">Or enter this key manually:</p>
                <code className="block w-full text-center p-2 bg-gray-100 rounded text-sm text-gray-800 break-all">
                  {manualEntryKey}
                </code>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleVerify}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  2. Enter the 6-digit code to verify
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  className="block w-full px-3 py-3 text-center tracking-widest text-2xl border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  placeholder="000000"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              <button
                type="submit"
                disabled={loading || token.length !== 6}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
