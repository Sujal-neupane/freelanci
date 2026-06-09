import zxcvbn from 'zxcvbn';

interface Props {
  password: string;
}

export const PasswordStrengthMeter: React.FC<Props> = ({ password }) => {
  const result = zxcvbn(password);
  const score = result.score; // 0 to 4

  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  if (!password) return null;

  return (
    <div className="password-strength">
      <div className="password-strength-bar">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`password-strength-segment ${i < score ? `active score-${score}` : ''}`}
          />
        ))}
      </div>
      <div className="password-strength-label">
        {labels[score]}
        {result.feedback.warning && ` — ${result.feedback.warning}`}
      </div>
    </div>
  );
};
