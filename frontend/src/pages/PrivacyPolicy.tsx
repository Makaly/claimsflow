import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200">
      <header className="border-b border-white/10 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-600/20">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">ClaimsFlow</p>
              <p className="text-xs text-slate-400">CIC Insurance Group PLC</p>
            </div>
          </div>
          <Link to="/register">
            <Button variant="ghost" className="text-slate-300 hover:text-white">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <Lock className="h-6 w-6 text-emerald-400" />
          <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        </div>
        <p className="mb-10 text-sm text-slate-400">
          Effective date: 23 April 2026 &middot; Last updated: 23 April 2026
        </p>

        <section className="space-y-10 text-[15px] leading-relaxed text-slate-300">
          <Block title="1. Who we are">
            <p>
              This Privacy Policy explains how <strong>CIC Insurance Group PLC</strong>
              (&ldquo;<strong>CIC</strong>&rdquo;, &ldquo;<strong>we</strong>&rdquo;,
              &ldquo;<strong>our</strong>&rdquo; or &ldquo;<strong>us</strong>&rdquo;) collects,
              uses, shares and protects personal data processed through the ClaimsFlow platform
              (the &ldquo;<strong>Platform</strong>&rdquo;). CIC is the data controller for the
              personal data described in this Policy, registered with the Office of the Data
              Protection Commissioner (&ldquo;<strong>ODPC</strong>&rdquo;) under registration
              number ODPC.ENT.0123456 (Entity Data Controller).
            </p>
            <p>
              This Policy is issued in compliance with the <em>Data Protection Act, 2019</em> and
              the Data Protection (General) Regulations, 2021 of the Republic of Kenya (together
              the &ldquo;<strong>KDPA</strong>&rdquo;).
            </p>
          </Block>

          <Block title="2. Scope">
            <p>
              This Policy applies to personal data we process when you: (a) register or use an
              account on the Platform; (b) lodge, assess, approve, reject, escalate or audit a
              claim; (c) upload documents or communicate through the Platform; or (d) interact
              with CIC personnel, branches or service providers in connection with the Platform.
              It does not cover personal data processed outside the Platform (for example in
              standalone policy-issuance systems), which are governed by their own notices.
            </p>
          </Block>

          <Block title="3. Categories of personal data we collect">
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Identity data</strong>: full name, national ID or passport number,
                KRA PIN, date of birth, gender, photograph, signature.
              </li>
              <li>
                <strong>Contact data</strong>: postal address, physical address, email address,
                telephone numbers.
              </li>
              <li>
                <strong>Account &amp; authentication data</strong>: username, hashed password,
                two-factor secrets, login timestamps, IP address, device and browser
                fingerprints, session tokens.
              </li>
              <li>
                <strong>Role &amp; employment data</strong>: employer (CIC or service provider),
                branch, job title, assigned role, professional licence numbers where relevant.
              </li>
              <li>
                <strong>Claim data</strong>: policy number, claim particulars, incident details,
                amounts, supporting invoices, photographs and other documents.
              </li>
              <li>
                <strong>Health data</strong> (a special category under the KDPA): where a medical
                claim is processed, diagnoses, ICD codes, treatment notes, prescriptions and
                medical reports.
              </li>
              <li>
                <strong>Financial data</strong>: bank account, mobile-money identifiers and
                payment references used to settle claims.
              </li>
              <li>
                <strong>Usage &amp; audit data</strong>: every action taken in the Platform
                (create, view, edit, approve, reject, escalate, export, print), timestamps,
                queue transitions, fraud-flag reasons and system logs.
              </li>
              <li>
                <strong>Communications</strong>: messages, comments and notes exchanged within
                the Platform.
              </li>
            </ul>
          </Block>

          <Block title="4. How we collect personal data">
            <p>We collect personal data:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>directly from you when you register, log in or use the Platform;</li>
              <li>
                from your employer (CIC or a Service Provider) when they provision your account
                or assign your role;
              </li>
              <li>
                from policyholders, members and claimants via Service Providers lodging claims
                on their behalf (with the member&rsquo;s consent);
              </li>
              <li>
                from third-party verification, identity, anti-fraud and reference databases
                lawfully accessible to CIC;
              </li>
              <li>
                automatically from your device (IP address, browser, device identifiers,
                cookies) when you access the Platform.
              </li>
            </ul>
          </Block>

          <Block title="5. Purposes and legal bases for processing">
            <p>We process personal data for the following purposes, on the legal bases noted:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Providing the Platform</strong> (account creation, authentication,
                workflow routing, claim adjudication) &mdash; performance of a contract and our
                legitimate interests in operating the Platform (s.30 KDPA).
              </li>
              <li>
                <strong>Processing insurance claims and making payments</strong> &mdash;
                performance of the insurance contract between CIC and the insured and compliance
                with our legal obligations under the Insurance Act.
              </li>
              <li>
                <strong>Health-data processing for medical claims</strong> &mdash; explicit
                consent of the data subject obtained through the member enrolment and claim
                process, and/or reasons of substantial public interest in the sound
                administration of health-benefit schemes (s.44&ndash;46 KDPA).
              </li>
              <li>
                <strong>Fraud detection, investigation and prevention</strong> &mdash; legitimate
                interests and legal obligations under the Insurance Act and the Proceeds of
                Crime and Anti-Money Laundering Act.
              </li>
              <li>
                <strong>Audit, reporting and regulatory compliance</strong> &mdash; legal
                obligations, including reporting to the Insurance Regulatory Authority and
                tax/regulatory authorities.
              </li>
              <li>
                <strong>Information-security, access control and incident response</strong>
                &mdash; legitimate interests in keeping the Platform and your data secure.
              </li>
              <li>
                <strong>Service improvement, analytics and user support</strong> &mdash;
                legitimate interests, using de-identified or aggregated data where possible.
              </li>
            </ul>
          </Block>

          <Block title="6. Who we share personal data with">
            <p>We disclose personal data only to the extent necessary, to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                authorised employees, officers and contractors of CIC acting within their Role;
              </li>
              <li>
                Service Providers and their authorised users, limited to claims and members they
                are entitled to service;
              </li>
              <li>
                reinsurers, co-insurers, loss adjusters, assessors, investigators and legal
                advisers engaged in connection with a claim;
              </li>
              <li>
                regulators and public authorities (including the IRA, ODPC, KRA, CBK, DCI, the
                courts and tribunals) where required by law or by lawful order;
              </li>
              <li>
                cloud infrastructure, communication, identity-verification, document-recognition
                and payment providers acting as our data processors under written contracts that
                impose KDPA-compliant safeguards;
              </li>
              <li>
                prospective or actual assignees, acquirers or successors of CIC&rsquo;s business,
                subject to appropriate confidentiality undertakings.
              </li>
            </ul>
            <p>
              We do not sell personal data, and we do not share it for third-party advertising.
            </p>
          </Block>

          <Block title="7. International transfers">
            <p>
              Some of our processors may be located outside Kenya. Where personal data is
              transferred outside Kenya we rely on one of the lawful bases permitted by sections
              48&ndash;50 of the KDPA, including transfers to jurisdictions with an adequate
              level of protection, transfers subject to appropriate safeguards (such as standard
              contractual clauses and binding corporate rules), or your explicit consent. You may
              request details of the safeguards applied by contacting our Data Protection Officer.
            </p>
          </Block>

          <Block title="8. Retention">
            <p>
              We retain personal data only for as long as necessary to fulfil the purposes for
              which it was collected and to comply with our legal, regulatory, accounting and
              reporting obligations. Indicative retention periods:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Claim records and supporting documents</strong>: not less than seven (7)
                years after final settlement, consistent with insurance, tax and anti-money-
                laundering record-keeping requirements;
              </li>
              <li>
                <strong>Audit logs and security logs</strong>: up to seven (7) years to support
                fraud investigation and regulatory audit;
              </li>
              <li>
                <strong>Account data</strong>: for the duration of your employment or engagement
                plus a reasonable archival period, after which it is deleted or anonymised.
              </li>
            </ul>
            <p>
              Where a longer period is required by law, regulator instruction or active
              litigation, data may be retained for that longer period.
            </p>
          </Block>

          <Block title="9. Your rights as a data subject">
            <p>Subject to the KDPA, you have the right to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>be informed of the use to which your personal data is put;</li>
              <li>access your personal data in our custody;</li>
              <li>
                object to the processing of all or part of your personal data, on reasonable
                grounds;
              </li>
              <li>
                correct false or misleading data and have personal data deleted where permitted;
              </li>
              <li>
                withdraw a consent on which processing relies, without prejudice to lawful
                processing carried out before withdrawal;
              </li>
              <li>
                data portability, where processing is based on consent or contract and carried
                out by automated means;
              </li>
              <li>
                not to be subjected to solely automated decision-making that produces legal or
                similarly significant effects, without appropriate safeguards.
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact our Data Protection Officer using the
              details in section 13. We will respond within the statutory period of seven (7)
              days, or otherwise within a reasonable period consistent with the KDPA.
            </p>
          </Block>

          <Block title="10. Security">
            <p>
              We implement appropriate technical and organisational measures to protect personal
              data, including role-based access control, least-privilege provisioning,
              two-factor authentication for sensitive roles, encrypted transmission (TLS),
              encryption at rest for sensitive stores, comprehensive audit logging, segregated
              environments, vulnerability management and incident-response procedures. No system
              is perfectly secure; in the event of a personal-data breach likely to result in
              risk to you we will notify the ODPC and, where required, the affected data
              subjects, in accordance with the KDPA.
            </p>
          </Block>

          <Block title="11. Cookies and similar technologies">
            <p>
              The Platform uses strictly necessary cookies and local storage to maintain sessions,
              enforce authentication, remember role context and protect against cross-site
              request forgery. Because these are essential to the service, they are used on the
              basis of our legitimate interest in providing a secure platform and cannot be
              disabled without impairing functionality. We do not use advertising or cross-site
              tracking cookies on the Platform.
            </p>
          </Block>

          <Block title="12. Children">
            <p>
              The Platform is intended for use by authorised adult personnel of CIC and of
              registered Service Providers, and is not directed at persons under 18. We may
              nonetheless process personal data about minors when they are beneficiaries of a
              claim; such data is handled under the same safeguards as adult data, with
              parent-or-guardian consent where required under s.33 of the KDPA.
            </p>
          </Block>

          <Block title="13. Data Protection Officer and contact">
            <p>
              You may contact our Data Protection Officer (DPO) at:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Email:{' '}
                <a className="text-emerald-400 hover:text-emerald-300" href="mailto:dpo@cic.co.ke">
                  dpo@cic.co.ke
                </a>
              </li>
              <li>Phone: +254 (0)20 282 3000 (ask for Data Protection Officer)</li>
              <li>
                Post: Data Protection Officer, CIC Insurance Group PLC,
                CIC Plaza, Mara Road, Upper Hill, P.O. Box 59485&ndash;00200, Nairobi, Kenya.
              </li>
            </ul>
          </Block>

          <Block title="14. Complaints to the regulator">
            <p>
              If you believe your rights under the KDPA have been infringed you may lodge a
              complaint directly with the Office of the Data Protection Commissioner via{' '}
              <a
                className="text-emerald-400 hover:text-emerald-300"
                href="https://www.odpc.go.ke"
                target="_blank"
                rel="noreferrer"
              >
                www.odpc.go.ke
              </a>{' '}
              or through the contact details published by the ODPC from time to time. We ask
              that you contact our DPO first so we may try to resolve your concern.
            </p>
          </Block>

          <Block title="15. Changes to this Policy">
            <p>
              We may update this Policy to reflect changes in our processing activities or in the
              law. Material changes will be communicated through the Platform and, where
              appropriate, by email. The &ldquo;Effective date&rdquo; at the top of this Policy
              indicates when it was last revised.
            </p>
          </Block>
        </section>

        <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6 text-sm text-slate-400">
          <Link to="/terms" className="text-emerald-400 hover:text-emerald-300">
            Read the Terms of Service &rarr;
          </Link>
          <Link to="/register">
            <Button className="bg-emerald-600 hover:bg-emerald-500">Back to registration</Button>
          </Link>
        </div>
      </main>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
