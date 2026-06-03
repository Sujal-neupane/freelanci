import apiClient from './client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'CLIENT' | 'FREELANCER' | 'ADMIN';
  mfaEnabled: boolean;
}

export const getMe = async (): Promise<User> => {
  const { data } = await apiClient.get('/auth/me');
  return data.user;
};

export const logout = async (): Promise<void> => {
  await apiClient.post('/auth/logout');
};
