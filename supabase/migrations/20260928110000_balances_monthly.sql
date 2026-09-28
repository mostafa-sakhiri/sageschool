-- Scolarité : filtre par mois, frais d'inscription à part. La vue des soldes
-- dit si l'échéance est une mensualité (plan mensuel) ; le reste (frais
-- d'inscription, frais uniques) se filtre séparément. Les parents ne lisent
-- pas fee_plans : la fréquence passe par une fonction.
CREATE FUNCTION private.is_monthly_plan(p_plan_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT f.frequency = 'monthly' FROM public.fee_plans f WHERE f.id = p_plan_id), false);
$$;
REVOKE ALL ON FUNCTION private.is_monthly_plan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_monthly_plan(uuid) TO authenticated;

CREATE OR REPLACE VIEW installment_balances WITH (security_invoker = true) AS
SELECT
  i.id,
  i.school_id,
  i.student_id,
  i.academic_year_id,
  i.label,
  i.due_on,
  i.amount_due,
  COALESCE(SUM(p.amount), 0)                       AS amount_paid,
  i.amount_due - COALESCE(SUM(p.amount), 0)        AS amount_remaining,
  CASE
    WHEN i.status = 'cancelled'                    THEN 'cancelled'
    WHEN COALESCE(SUM(p.amount), 0) >= i.amount_due THEN 'paid'
    WHEN i.due_on < current_date                   THEN 'overdue'
    WHEN COALESCE(SUM(p.amount), 0) > 0            THEN 'partial'
    ELSE 'pending'
  END AS payment_status,
  private.is_monthly_plan(i.fee_plan_id)            AS monthly
FROM fee_installments i
LEFT JOIN payments p ON p.installment_id = i.id
GROUP BY i.id;
