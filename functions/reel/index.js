// /reel with no code: there is nothing to show yet — send them to the bin.
export function onRequestGet({ request }) {
  return Response.redirect(new URL('/#work', request.url).toString(), 302);
}
