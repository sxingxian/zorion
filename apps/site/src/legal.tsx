import { type ReactNode, useEffect, useState } from 'react';

// Draft wording, written from what the code does. Have it reviewed before launch,
// and keep it in step with the code: if what Zorion collects or sends changes, change this page.
const UPDATED = '13 November 2026';
const APP = 'https://zorionapp.midnightpoetry.studio';

function Page({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    document.title = `${title} · Zorion`;
    window.scrollTo(0, 0);
    fetch('/api/public/config').then((r) => r.json()).then((c) => setEmail(c.contactEmail ?? null)).catch(() => {});
  }, [title]);
  return (
    <div className="legal">
      <header><a className="brandmark" href="/">Zorion</a><nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></header>
      <main>
        <h1 className="display">{title}</h1>
        <p className="lede">{intro}</p>
        <p className="meta">Last updated {UPDATED}</p>
        {children}
        <h2>Contact</h2>
        <p>Zorion is made by Midnight Poetry Studio. {email ? <>Write to <a href={`mailto:${email}`}>{email}</a> with any question or request about this page.</> : 'A contact address will be published here before Zorion opens to the public.'}</p>
      </main>
      <footer><a href="/">Back to Zorion</a><span>© {new Date().getFullYear()} Midnight Poetry Studio</span></footer>
    </div>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy" intro="Zorion plans a meetup around where everyone is coming from. That makes location the most sensitive thing it handles, so this page starts there.">
      <h2>Where you are starting from</h2>
      <ul>
        <li>You give it once per meetup, either by sharing your device's location or by typing a place.</li>
        <li>If you type a place, its name is kept with it so you can see what you picked. Only you see the name.</li>
        <li>It is used to work out the fair middle and your own travel time.</li>
        <li>On the crew map, others see only a rough area about 1 km wide, with no name, its centre moved by a fixed random amount, and a route line that starts at its edge. That includes the host.</li>
        <li>If you turn on "Show me on the crew map", the others in this meetup see your exact starting point and your name. You can turn it off at any time.</li>
        <li>The middle is only shown once three or more people have added a start.</li>
        <li>It, and the name of a typed place, is erased when the meetup ends, which is 24 hours after its start time. A meetup that never gets a date ends 30 days after its last change. The rest of the meetup is deleted 90 days after it ends.</li>
      </ul>

      <h2>What Zorion keeps</h2>
      <h3>If you join as a guest</h3>
      <p>No account. Zorion keeps the name you pick or type, your reply, your votes, your starting point (as above), and a protected form of your 4-character code. A cookie remembers your browser so you do not have to enter the code each visit.</p>
      <p>You can choose to leave an email address to hear when the date or the place is set. It is used only for that meetup and only after you confirm it from your inbox. The host and the other guests never see it. It is erased when you stop the emails or when the meetup ends, whichever comes first.</p>
      <p>You can also choose to get the same updates on Telegram. Zorion then keeps the number Telegram uses for your chat with our bot, for that meetup only, and erases it when you send /stop, when you stop it on the meetup page, or when the meetup ends.</p>
      <h3>If you host</h3>
      <p>Your email address, the name shown on your meetups, your plan, and your sign-in details: a protected form of your password if you set one, and your authenticator key in encrypted form if you turn on two-step verification. If you buy Pro, Zorion keeps the customer and subscription references Stripe gives it. Card details go to Stripe and never reach Zorion.</p>
      <h3>For everyone</h3>
      <p>To limit guessing and abuse, Zorion keeps a scrambled form of your network address next to a count of recent attempts, for up to a day. Our hosting provider keeps short-lived technical logs of requests.</p>

      <h2>Who else is involved</h2>
      <p>Zorion sends other companies only what each needs to do its part:</p>
      <ul>
        <li><strong>Cloudflare</strong> runs the site and the app. <strong>Neon</strong> stores the database.</li>
        <li><strong>Resend</strong> delivers our emails: sign-in codes and meetup news to hosts, and updates to guests who asked for them. It receives the address and the content of each email.</li>
        <li><strong>Telegram</strong> delivers the same news and updates to people who chose to connect it. Telegram receives the content of each message, and Zorion keeps the number Telegram uses for your chat.</li>
        <li><strong>Stripe</strong> takes payment for Pro on its own pages.</li>
        <li><strong>Places search</strong> (Google Maps Platform, Geoapify or OpenStreetMap services) receives the middle point and the kind of food, to find places near it. It does not receive anyone's starting point or name. The app shows which service found the places.</li>
        <li><strong>Typed places.</strong> If you type a place instead of sharing your location, the words you type go from our server to a map service to be looked up: Google Maps Platform, OneMap (run by the Singapore Land Authority), Geoapify or OpenStreetMap's Nominatim, tried in that order. To put nearby results first, a rough point (to about 10 km) for the meetup's area goes with them. Your name and network address do not. The app shows which service answered.</li>
        <li><strong>Map tiles.</strong> The crew map is drawn from tiles your browser loads straight from a free map service: OneMap (Singapore Land Authority) in Singapore, otherwise OpenFreeMap, VersaTiles or Maptoolkit. That service sees your network address and the area you are looking at, as with any website that shows a map. It does not receive names, votes or anyone's starting point.</li>
        <li><strong>Route lines.</strong> To draw each person's route on the crew map, the routing service gets the start (or, for anyone not sharing their pin, the moved centre of their rough area) and the middle or the place, with no names. If trip times are set to Zorion's estimate, routes are drawn as straight lines and nothing is sent.</li>
        <li><strong>Routed travel times.</strong> Zorion normally estimates travel time itself. If we switch on routed times, each starting point and the candidate places are sent to a routing service to be routed, with no names attached. That service is one of: Google Maps Platform, OneMap, openrouteservice run by HeiGIT, Geoapify, or the OpenStreetMap routing servers run by FOSSGIS. When one is unavailable or its free allowance is used up, the next is tried. The app shows which service gave the times.</li>
      </ul>
      <p>We do not sell personal data, and Zorion has no analytics or tracking scripts.</p>

      <h2>Cookies and ads</h2>
      <ul>
        <li><strong>The app</strong> uses only the cookies it needs: one that keeps a host signed in, and one that remembers a guest's browser. Your light or dark choice is stored on your device.</li>
        <li><strong>Sponsored spots in the app</strong> are shown by Zorion itself and are always labelled. Nothing about you is shared, and a sponsored place never changes the fair-middle ranking. Zorion counts how many times a spot was shown, not who saw it.</li>
        <li><strong>Google ads in the app.</strong> Free users may see Google AdSense ads in the app. Where we ask for your consent first, nothing from Google loads until you agree. The ad loads inside a separate frame from zorion.midnightpoetry.studio, so Google cannot see the app's pages, your meetups or your sign-in. Inside that frame, Google and its partners may place and read cookies or use similar technology to show and measure ads, including ads based on your earlier visits to other sites. You can turn off personalised ads in <a href="https://adssettings.google.com/" rel="noopener noreferrer">Google's Ads Settings</a>, and read <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">how Google uses information from sites that use its services</a>. Pro users see no ads.</li>
        <li><strong>This website</strong> shows no ads and sets no cookies, except on the admin portal.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Guests</strong> can change any reply, vote or starting point from the meetup link, using their code, until the host confirms the plan. After that only the reply can change; your starting point is still erased when the meetup ends, or sooner if you write to us. To have your name removed from a meetup, ask the host or write to us.</li>
        <li><strong>Hosts</strong> can download their data and delete their account from the Account screen in the app. Deleting an account deletes its meetups. Emails about your meetups can be switched off there too; sign-in codes cannot, because they are how you sign in.</li>
        <li><strong>Email updates for guests</strong> stop from the link in any of the emails, or from the meetup page. <strong>Telegram updates</strong> stop when you send /stop to the bot, from the meetup page, or, for hosts, under Account.</li>
        <li>You can refuse location permission and type a place instead, or reply without sharing a starting point at all. The middle is then worked out without you.</li>
        <li>Depending on where you live, the law may give you further rights over your data, such as access, correction or deletion. Write to us and we will act on them.</li>
      </ul>

      <h2>Keeping it safe</h2>
      <p>Passwords and codes are stored only in protected, one-way form. Authenticator keys are encrypted. Connections are encrypted. Our own admin tools do not show anyone's location, and sensitive admin actions need a second person to approve them and are logged.</p>

      <h2>Children</h2>
      <p>Zorion is made for adults arranging to meet. It is not directed at children under 13, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If what Zorion collects or shares changes, this page changes first, and the date at the top changes with it.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms" intro="The short version: use Zorion to plan meetups with people who want to be invited, look after your link and your account, and use your own judgment about where and when you meet.">
      <h2>Using Zorion</h2>
      <ul>
        <li>Hosting needs an account. Joining a meetup as a guest does not.</li>
        <li>A meetup link lets anyone who has it join that meetup. Share it only with the people you mean to invite.</li>
        <li>Keep your sign-in details and your guest code to yourself. Tell us if you think someone else has used your account.</li>
        <li>You must be old enough to agree to these terms where you live.</li>
      </ul>

      <h2>What is not allowed</h2>
      <ul>
        <li>Names or categories that are abusive, hateful, sexual or meant to mislead.</li>
        <li>Adding people who have not agreed to take part, or using Zorion to find, follow or harass anyone.</li>
        <li>Trying to guess codes, get into other people's meetups or accounts, overload the service, or work around its limits.</li>
        <li>Anything unlawful.</li>
      </ul>
      <p>We may remove content, pause a link, or suspend or close an account that breaks these rules.</p>

      <h2>Places, times and meeting up</h2>
      <ul>
        <li>Places come from outside map services. Names, addresses, ratings and opening hours can be wrong or out of date. Check before you travel.</li>
        <li>Travel times are estimates unless the app says they follow real routes, and even routed times are a guide.</li>
        <li>Zorion suggests where to meet. It does not vet places or people, and you are responsible for your own safety and choices when you travel and meet.</li>
      </ul>

      <h2>Free and Pro</h2>
      <ul>
        <li>Hosting is free and shows ads and sponsored places, always labelled.</li>
        <li>Pro is a subscription, paid monthly or yearly through Stripe. The price is shown at checkout before you pay.</li>
        <li>Pro renews automatically until you cancel. You can cancel at any time from the Account screen; Pro then runs to the end of the period already paid for.</li>
        <li>Refunds are given where the law that applies to you requires them. Write to us if something has gone wrong with a payment.</li>
        <li>We may change what Free and Pro include or cost. A price change never applies to a period you have already paid for.</li>
      </ul>

      <h2>Your content and ours</h2>
      <p>Meetup names, your own categories and the names you add remain yours; you allow us to store and show them to the people in that meetup so the service can work. Zorion's name, mascot, design and software belong to Midnight Poetry Studio.</p>

      <h2>The service</h2>
      <p>We work to keep Zorion available and correct, but it is provided as it is, without a promise that it will always be available or free of mistakes. To the extent the law allows, Midnight Poetry Studio is not liable for indirect or consequential loss arising from use of Zorion. Nothing in these terms limits rights you have under consumer law that cannot be limited.</p>

      <h2>Ending</h2>
      <p>You can stop using Zorion at any time, and hosts can delete their account from the Account screen. We may end or suspend access for a breach of these terms.</p>

      <h2>Changes</h2>
      <p>If these terms change in a way that matters, we will say so here and change the date at the top. Continuing to use Zorion after a change means you accept it.</p>

      <p className="meta">Open the app: <a href={APP}>{APP.replace('https://', '')}</a></p>
    </Page>
  );
}
