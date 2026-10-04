// 다있쌤 소개 사이트(Cloudflare Workers + 정적 파일 site/).
// http 로 들어오면 https 로 넘긴다 — workers.dev 주소에는 Cloudflare 의 'Always Use HTTPS' 설정이 없어서
// 여기서 한다(보안 점검: "HTTP로 접속해도 HTTPS로 자동 전환되지 않습니다"). 나머지는 site/ 파일을 그대로 준다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
