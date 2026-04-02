// client/src/setupAxios.js
import axios from "axios";

axios.defaults.baseURL = process.env.REACT_APP_API_URL; // <- base url de la API
axios.defaults.withCredentials = false; // tu API usa JWT en Authorization (no cookies)

export default axios;
